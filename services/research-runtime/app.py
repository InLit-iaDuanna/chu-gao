import asyncio
import hashlib
import importlib.util
import ipaddress
import json
import logging
import os
from pathlib import Path
import signal
import socket
import sys
import base64
import io
import zipfile
import shutil
import time
from urllib.parse import urlparse, urljoin

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse

app = FastAPI()
ROOT = Path(os.environ.get("RESEARCH_RUN_ROOT", "/work/runs"))
ROOT.mkdir(parents=True, exist_ok=True)
ENGINE = os.environ.get("RESEARCH_ENGINE", "crawl4ai")
processes = {}
crawl_lock = asyncio.Lock()
MAX_EVENT_BYTES = 8 * 1024 * 1024


@app.on_event("startup")
async def start_retention():
    async def maintain():
        while True:
            for state_file in ROOT.glob("*/state.json"):
                folder = state_file.parent
                if folder.name in processes:
                    continue
                try:
                    state = json.loads(state_file.read_text())
                    expiry = state.get("expiresAt", state_file.stat().st_mtime + 30 * 86400)
                    if expiry <= time.time():
                        shutil.rmtree(folder)
                except (OSError, ValueError):
                    continue
            await asyncio.sleep(3600)
    asyncio.create_task(maintain())


def run_dir(run_id):
    if not run_id or len(run_id) > 100 or not all(c.isalnum() or c in "-_" for c in run_id):
        raise HTTPException(400, "Invalid run id")
    return ROOT / run_id


def write_state(folder, state):
    temporary = folder / "state.tmp"
    temporary.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    temporary.replace(folder / "state.json")


@app.get("/health")
async def health():
    module = {"crawl4ai": "crawl4ai", "gpt-researcher": "gpt_researcher", "deerflow": "deerflow"}.get(ENGINE)
    available = bool(module and importlib.util.find_spec(module))
    if not available:
        raise HTTPException(503, f"Engine module unavailable: {ENGINE}")
    if ENGINE in ("gpt-researcher", "deerflow") and not Path("/bridge/.assembly-ready").exists():
        raise HTTPException(503, "Framework assembly has not passed its local check")
    if ENGINE == "crawl4ai":
        from importlib.metadata import version
        return {"ok": True, "engine": ENGINE, "protocol": 1, "running": len(processes), "capturePipeline": "http-first-v1", "trafilatura": version("trafilatura"), "pdf": version("pypdf")}
    return {"ok": True, "engine": ENGINE, "protocol": 1, "running": len(processes)}


async def process_lines(stream):
    pending = bytearray()
    while chunk := await stream.read(65536):
        pending.extend(chunk)
        while (end := pending.find(b"\n")) >= 0:
            if end > MAX_EVENT_BYTES:
                raise ValueError("Engine event exceeds the 8 MiB protocol limit")
            line = bytes(pending[:end])
            del pending[:end + 1]
            yield line
        if len(pending) > MAX_EVENT_BYTES:
            raise ValueError("Engine event exceeds the 8 MiB protocol limit")
    if pending:
        yield bytes(pending)


async def stop_process(process):
    if process.returncode is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        await asyncio.wait_for(process.wait(), timeout=5)
    except asyncio.TimeoutError:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()


async def discard_process_output(stream):
    while await stream.read(65536):
        pass


async def consume_process(run_id, process):
    folder = run_dir(run_id)
    result = None
    protocol_error = None
    try:
        with (folder / "events.jsonl").open("a", encoding="utf-8") as events:
            async for line in process_lines(process.stdout):
                try:
                    event = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if not isinstance(event, dict) or "type" not in event:
                    continue
                state = json.loads((folder / "state.json").read_text())
                if event["type"] == "result":
                    result = event.get("data", {})
                state["seq"] += 1
                event["seq"] = state["seq"]
                events.write(json.dumps(event, ensure_ascii=False) + "\n")
                events.flush()
                write_state(folder, state)
    except Exception:
        protocol_error = "研究引擎进度读取失败，已有材料已保存，本阶段可以重试"
        draining = asyncio.create_task(discard_process_output(process.stdout))
        try:
            await stop_process(process)
        finally:
            await draining
    finally:
        try:
            code = await process.wait()
            state = json.loads((folder / "state.json").read_text())
            state["status"] = "cancelled" if state["status"] == "cancelled" else "completed" if code == 0 and result is not None and not protocol_error else "failed"
            state["result"] = result
            state["expiresAt"] = time.time() + state.get("retentionDays", 30) * 86400
            if state["status"] == "failed":
                state["error"] = protocol_error or "研究引擎执行失败，已保存完成的事件与材料"
                diagnostic_file = folder / "stderr.log"
                diagnostic = ""
                if diagnostic_file.exists():
                    with diagnostic_file.open("rb") as log:
                        log.seek(max(0, diagnostic_file.stat().st_size - 8192))
                        diagnostic = log.read().decode("utf-8", errors="replace").strip()
                detail = diagnostic.splitlines()[-1][:500] if diagnostic else ""
                try:
                    secret = json.loads((folder / "input.json").read_text()).get("gatewayToken", "")
                    if secret:
                        detail = detail.replace(secret, "[redacted]")
                except (OSError, ValueError):
                    pass
                if detail:
                    state["errorDetail"] = detail
            write_state(folder, state)
        finally:
            processes.pop(run_id, None)


async def watch_attempt(run_id, process, body):
    import httpx
    failures = 0
    async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
        while process.returncode is None:
            await asyncio.sleep(5)
            if process.returncode is not None:
                return
            try:
                response = await client.get(body["gatewayUrl"].rstrip("/") + "/v1/models", headers={"Authorization": "Bearer " + body["gatewayToken"]})
                if response.status_code in (401, 403, 409):
                    await cancel_run(run_id)
                    return
                failures = 0 if response.is_success else failures + 1
            except httpx.HTTPError:
                failures += 1
            if failures >= 4:
                await cancel_run(run_id)
                return


@app.post("/runs")
async def start_run(request: Request):
    if ENGINE == "crawl4ai":
        raise HTTPException(404)
    body = await request.json()
    run_id = body.get("runId", "")
    folder = run_dir(run_id)
    input_hash = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    if (folder / "state.json").exists():
        state = json.loads((folder / "state.json").read_text())
        if state["inputHash"] != input_hash:
            raise HTTPException(409, "Run id already used for different input")
        if state["status"] == "running" and run_id not in processes:
            state["status"] = "interrupted"
            write_state(folder, state)
        return state
    if processes:
        raise HTTPException(429, "Engine is busy")
    folder.mkdir(mode=0o700)
    (folder / "input.json").write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    (folder / "input.json").chmod(0o600)
    write_state(folder, {"runId": run_id, "status": "running", "seq": 0, "inputHash": input_hash, "retentionDays": max(1, min(365, int(body.get("retentionDays", 30))))})
    error_log = (folder / "stderr.log").open("wb")
    process = await asyncio.create_subprocess_exec(sys.executable, "/bridge/engine.py", str(folder), stdout=asyncio.subprocess.PIPE, stderr=error_log, start_new_session=True, limit=2**21)
    error_log.close()
    processes[run_id] = process
    asyncio.create_task(consume_process(run_id, process))
    asyncio.create_task(watch_attempt(run_id, process, body))
    return {"runId": run_id, "status": "running"}


@app.get("/runs/{run_id}")
async def get_run(run_id: str, after: int = 0):
    folder = run_dir(run_id)
    if not (folder / "state.json").exists():
        raise HTTPException(404)
    state = json.loads((folder / "state.json").read_text())
    if state["status"] == "running" and run_id not in processes:
        state["status"] = "interrupted"
        write_state(folder, state)
    events = []
    if (folder / "events.jsonl").exists():
        for line in (folder / "events.jsonl").read_text(encoding="utf-8").splitlines():
            event = json.loads(line)
            if event["seq"] > after:
                events.append(event)
            if len(events) == 200:
                break
    files = []
    if state["status"] == "completed":
        for file in (folder / "outputs").glob("*"):
            if file.is_file() and not file.is_symlink() and file.stat().st_size <= 32 * 1024 * 1024:
                files.append({"name": file.name, "size": file.stat().st_size})
    return {**state, "events": events, "files": files}


@app.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str):
    folder = run_dir(run_id)
    if not (folder / "state.json").exists():
        raise HTTPException(404)
    state = json.loads((folder / "state.json").read_text())
    if state["status"] == "running":
        state["status"] = "cancelled"
        write_state(folder, state)
        process = processes.get(run_id)
        if process and process.returncode is None:
            await stop_process(process)
    return {"status": state["status"]}


@app.get("/runs/{run_id}/files/{filename}")
async def get_file(run_id: str, filename: str):
    if Path(filename).name != filename:
        raise HTTPException(400)
    file = run_dir(run_id) / "outputs" / filename
    if not file.is_file() or file.is_symlink() or file.stat().st_size > 32 * 1024 * 1024:
        raise HTTPException(404)
    return FileResponse(file)


@app.delete("/runs/{run_id}/payload")
async def release_run_payload(run_id: str):
    folder = run_dir(run_id)
    if not (folder / "state.json").exists():
        raise HTTPException(404)
    state = json.loads((folder / "state.json").read_text())
    if run_id in processes or state["status"] == "running":
        raise HTTPException(409, "Run still active")
    # Chugao retains the authoritative evidence and artifacts; discard engine copies and scoped tokens.
    for name in ("input.json", "gptr.json", "deerflow.yaml", "stderr.log", "events.jsonl"):
        (folder / name).unlink(missing_ok=True)
    for name in ("outputs", "deerflow"):
        shutil.rmtree(folder / name, ignore_errors=True)
    state.pop("result", None)
    state["released"] = True
    write_state(folder, state)
    return {"released": True}


async def public_url(value):
    try:
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            return False
        addresses = await asyncio.wait_for(asyncio.to_thread(socket.getaddrinfo, parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)), timeout=5)
        return bool(addresses) and all(ipaddress.ip_address(entry[4][0]).is_global for entry in addresses)
    except (OSError, ValueError, asyncio.TimeoutError):
        return False


async def install_public_routes(page, context):
    from playwright.async_api import Error
    checks = {}

    async def route_request(route):
        if page.is_closed():
            return
        url = route.request.url
        try:
            parsed = urlparse(url)
            key = (parsed.scheme, parsed.hostname, parsed.port)
            if url.startswith("data:"):
                allowed = True
            elif parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
                allowed = False
            else:
                if key not in checks:
                    checks[key] = asyncio.create_task(public_url(url))
                allowed = await asyncio.shield(checks[key])
            if page.is_closed():
                return
            if allowed:
                await route.continue_()
            else:
                await route.abort()
        except Error:
            if not page.is_closed():
                raise
        except ValueError:
            if not page.is_closed():
                await route.abort()

    await context.route("**/*", route_request)


def capture_failure(detail="", status=None):
    text = str(detail).lower()
    if "challenge" in text or "captcha" in text or "anti-bot" in text:
        code, message, retryable = "CRAWL_CHALLENGE", "来源要求访问验证，未取得有效正文或截图", False
    elif status in (401, 403):
        code, message, retryable = "CRAWL_BLOCKED", "来源网站拒绝访问，未取得正文", False
    elif status == 429:
        code, message, retryable = "CRAWL_RATE_LIMITED", "来源网站请求限流，未取得正文", True
    elif status in (404, 410):
        code, message, retryable = "CRAWL_NOT_FOUND", "来源页面不存在或已移除", False
    elif "timeout" in text or "timed out" in text:
        code, message, retryable = "CRAWL_TIMEOUT", "网页加载超时，未取得正文", True
    elif "name_not_resolved" in text or "name resolution" in text:
        code, message, retryable = "CRAWL_DNS_FAILED", "来源域名解析失败", True
    elif status and status >= 400:
        code, message, retryable = "CRAWL_HTTP_ERROR", f"来源网站返回 HTTP {status}，未取得正文", status >= 500
    else:
        code, message, retryable = "CRAWL_BROWSER_FAILED", "浏览器未能完成网页采集", False
    return HTTPException(502, {"code": code, "message": message, "httpStatus": status, "retryable": retryable})


@app.post("/crawl")
async def crawl(request: Request):
    if ENGINE != "crawl4ai":
        raise HTTPException(404)
    body = await request.json()
    url = str(body.get("url", ""))
    if not await public_url(url):
        raise HTTPException(400, "Only public HTTP pages can be captured")
    from capture_pipeline import SourceFailure, capture_page
    async with crawl_lock:
        try:
            async with asyncio.timeout(80):
                return await capture_page(url, bool(body.get("screenshot", False)), browser_capture)
        except SourceFailure as error:
            raise HTTPException(502, error.detail) from error
        except asyncio.TimeoutError as error:
            raise capture_failure("Capture timeout") from error


async def browser_capture(url, screenshot):
    from capture_pipeline import SourceFailure
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    try:
        async with AsyncWebCrawler(config=BrowserConfig(headless=True, viewport_width=1440, viewport_height=1000, verbose=False)) as crawler:
            contexts = []
            async def secure_context(page, context, **kwargs):
                await install_public_routes(page, context)
                contexts.append(context)
                return page
            crawler.crawler_strategy.set_hook("on_page_context_created", secure_context)
            try:
                result = await crawler.arun(url=url, config=CrawlerRunConfig(cache_mode=CacheMode.BYPASS, screenshot=screenshot, force_viewport_screenshot=True, page_timeout=35000, wait_until="domcontentloaded", delay_before_return_html=0.7, verbose=False))
            except Exception as error:
                logging.getLogger(__name__).warning("Capture raised url=%s detail=%.1000s", url, str(error))
                raise capture_failure(str(error)) from error
            finally:
                from playwright.async_api import Error
                for context in contexts:
                    try:
                        await context.unroute_all(behavior="wait")
                    except Error:
                        pass  # A navigation failure may already have closed the context.
            status = getattr(result, "status_code", None)
            if not result.success or (status and status >= 400):
                logging.getLogger(__name__).warning("Capture failed url=%s status=%s detail=%.1000s", url, status, result.error_message or "")
                raise capture_failure(result.error_message, status)
            markdown = getattr(result.markdown, "raw_markdown", str(result.markdown or ""))
            screenshot = result.screenshot
            if screenshot:
                from PIL import Image
                image = Image.open(io.BytesIO(base64.b64decode(screenshot)))
                image = image.crop((0, 0, min(image.width, 1440), min(image.height, 1000)))
                buffer = io.BytesIO()
                image.save(buffer, format="PNG")
                screenshot = base64.b64encode(buffer.getvalue()).decode()
            from bs4 import BeautifulSoup
            canonical = BeautifulSoup(result.html or "", "html.parser").find("link", rel="canonical")
            origin = urljoin(result.url, canonical.get("href", "")) if canonical else None
            return {"url": result.url, "title": (result.metadata or {}).get("title", ""), "markdown": markdown[:500000], "html": (result.html or "")[:1000000], "screenshot": screenshot, "media": result.media, "originUrl": origin, "httpStatus": status, "viewport": {"width": 1440, "height": 1000}}
    except HTTPException as error:
        if isinstance(error.detail, dict):
            raise SourceFailure(**error.detail) from error
        raise SourceFailure("CRAWL_BROWSER_FAILED", "浏览器未能完成网页采集") from error
    except Exception as error:
        raise SourceFailure("CRAWL_BROWSER_FAILED", "浏览器未能完成网页采集") from error


@app.post("/extract")
async def extract(request: Request):
    if ENGINE != "crawl4ai":
        raise HTTPException(404)
    body = await request.json()
    data = base64.b64decode(body.get("data", ""), validate=True)
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413)
    suffix = Path(body.get("filename", "")).suffix.lower()
    def convert():
        if suffix == ".pdf":
            from pypdf import PdfReader
            document = PdfReader(io.BytesIO(data))
            return "\n\n".join((page.extract_text() or "") for page in list(document.pages)[:80])[:500000]
        if suffix == ".docx":
            from docx import Document
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if sum(item.file_size for item in archive.infolist()) > 100 * 1024 * 1024:
                    raise ValueError("Document expands beyond limit")
            document = Document(io.BytesIO(data))
            paragraphs = [paragraph.text for paragraph in document.paragraphs]
            paragraphs.extend(" | ".join(cell.text for cell in row.cells) for table in document.tables for row in table.rows)
            return "\n".join(paragraphs)[:500000]
        if suffix in (".md", ".txt", ".csv"):
            return data.decode("utf-8-sig", errors="replace")[:500000]
        raise HTTPException(400, "Unsupported document")
    return {"text": await asyncio.to_thread(convert)}
