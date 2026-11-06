"""Local HTTP/text/PDF capture, with browser rendering only when needed."""
import asyncio
import hashlib
import io
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlparse

import aiohttp
from aiohttp.abc import AbstractResolver
from bs4 import BeautifulSoup

MAX_HTML_BYTES = 4 * 1024 * 1024
MAX_PDF_BYTES = 20 * 1024 * 1024
MIN_TEXT_CHARS = 160


class SourceFailure(Exception):
    def __init__(self, code, message, httpStatus=None, retryable=False):
        super().__init__(message)
        self.detail = {"code": code, "message": message, "httpStatus": httpStatus, "retryable": retryable}


def validate_target(url):
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Invalid HTTP URL")
        port = parsed.port
        if port is not None and port not in (80, 443):
            raise ValueError("Only standard HTTP ports are supported")
        try:
            address = ipaddress.ip_address(parsed.hostname)
        except ValueError:
            address = None
        if address is not None and not address.is_global:
            raise ValueError("Non-public address")
    except ValueError as error:
        raise SourceFailure("CRAWL_INVALID_URL", "只支持公开 HTTP/HTTPS 来源链接") from error
    return parsed


class PublicResolver(AbstractResolver):
    async def resolve(self, host, port=0, family=socket.AF_INET):
        # Return the checked IPs to the connector itself, not just a DNS preflight.
        entries = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(host, port, family=family, type=socket.SOCK_STREAM), timeout=5)
        if not entries or any(not ipaddress.ip_address(entry[4][0]).is_global for entry in entries):
            raise SourceFailure("CRAWL_INVALID_URL", "来源域名未解析到公开地址")
        return [{"hostname": host, "host": entry[4][0], "port": port, "family": entry[0], "proto": entry[2], "flags": socket.AI_NUMERICHOST} for entry in entries]

    async def close(self):
        pass


async def fetch_document(url):
    connector = aiohttp.TCPConnector(resolver=PublicResolver(), ttl_dns_cache=60, limit=2)
    timeout = aiohttp.ClientTimeout(total=18, connect=6, sock_read=8)
    async with aiohttp.ClientSession(connector=connector, timeout=timeout, trust_env=False, headers={"User-Agent": "Mozilla/5.0 (compatible; ChugaoResearch/1.0)", "Accept": "text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5"}) as client:
        current = url
        for _ in range(6):
            validate_target(current)
            async with client.get(current, allow_redirects=False) as response:
                if response.status in (301, 302, 303, 307, 308):
                    location = response.headers.get("Location")
                    if not location:
                        raise SourceFailure("CRAWL_REDIRECT_FAILED", "来源返回了没有目标地址的跳转")
                    current = urljoin(current, location)
                    validate_target(current)
                    continue
                if response.status >= 400:
                    code = "CRAWL_BLOCKED" if response.status in (401, 403) else "CRAWL_NOT_FOUND" if response.status in (404, 410) else "CRAWL_RATE_LIMITED" if response.status == 429 else "CRAWL_HTTP_ERROR"
                    raise SourceFailure(code, f"来源网站返回 HTTP {response.status}，未取得正文", response.status, response.status == 429 or response.status >= 500)
                content_type = response.headers.get("Content-Type", "").split(";")[0].lower().strip()
                pdf = content_type == "application/pdf" or urlparse(current).path.lower().endswith(".pdf")
                chunks, length = [], 0
                async for chunk in response.content.iter_chunked(16384):
                    if not chunks and chunk.lstrip().startswith(b"%PDF-"):
                        pdf = True
                    length += len(chunk)
                    if length > (MAX_PDF_BYTES if pdf else MAX_HTML_BYTES):
                        raise SourceFailure("CRAWL_DOCUMENT_TOO_LARGE", "来源文件超过采集大小上限", response.status)
                    chunks.append(chunk)
                return {"url": current, "data": b"".join(chunks), "contentType": content_type, "charset": response.charset or "utf-8", "pdf": pdf, "httpStatus": response.status}
        raise SourceFailure("CRAWL_REDIRECT_FAILED", "来源跳转次数过多，未取得正文")


def challenge_page(html):
    soup = BeautifulSoup(html[:200000], "html.parser")
    title = soup.title.get_text(" ", strip=True).lower() if soup.title else ""
    return "recaptcha/challengepage/" in html.lower() or title in ("just a moment...", "just a moment", "attention required! | cloudflare", "verify you are human") or (title == "access denied" and len(soup.get_text(" ", strip=True)) < 1500)


def extract_html(document):
    import trafilatura
    try:
        html = document["data"].decode(document.get("charset") or "utf-8", errors="replace")
    except LookupError:
        html = document["data"].decode("utf-8", errors="replace")
    if challenge_page(html):
        raise SourceFailure("CRAWL_CHALLENGE", "来源要求验证码或人工访问，未取得正文", document["httpStatus"])
    try:
        markdown = trafilatura.extract(html, url=document["url"], output_format="markdown", include_comments=False, include_tables=True, include_links=True, favor_precision=False) or ""
    except ValueError:
        markdown = ""
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else urlparse(document["url"]).hostname
    canonical = soup.find("link", rel="canonical")
    origin = urljoin(document["url"], canonical.get("href", "")) if canonical else None
    if origin:
        try:
            validate_target(origin)
        except SourceFailure:
            origin = None
    images = []
    for item in soup.find_all("img", src=True)[:20]:
        src = urljoin(document["url"], item["src"])
        if urlparse(src).scheme in ("http", "https"):
            images.append({"src": src, "alt": str(item.get("alt", ""))[:300]})
    return {"url": document["url"], "title": title, "markdown": markdown[:500000], "html": html[:1000000], "originUrl": origin, "media": {"images": images}, "screenshot": None, "captureMethod": "http-trafilatura", "httpStatus": document["httpStatus"], "sourceFormat": "html", "screenshotStatus": "not_requested"}


def extract_pdf(document):
    from pypdf import PdfReader
    try:
        reader = PdfReader(io.BytesIO(document["data"]), strict=False)
        if reader.is_encrypted and not reader.decrypt(""):
            raise SourceFailure("CRAWL_PDF_ENCRYPTED", "来源 PDF 已加密，无法提取正文")
        text, chars = [], 0
        for index, page in enumerate(reader.pages):
            if index >= 80 or chars >= 500000:
                break
            value = page.extract_text() or ""
            chars += len(value)
            text.append(f"## 第 {index + 1} 页\n\n{value}")
        if not any(re.search(r"\w", item.split("\n\n", 1)[-1]) for item in text):
            raise SourceFailure("CRAWL_PDF_NO_TEXT", "PDF 没有可提取文字，可能需要 OCR；未把图片当作已读正文")
        metadata = reader.metadata or {}
        return {"url": document["url"], "title": metadata.get("/Title") or urlparse(document["url"]).path.rsplit("/", 1)[-1], "markdown": "\n\n".join(text)[:500000], "html": "", "originUrl": None, "screenshot": None, "media": {}, "captureMethod": "http-pypdf", "sourceFormat": "pdf", "httpStatus": document["httpStatus"], "screenshotStatus": "not_applicable", "document": {"pages": len(reader.pages), "extractedPages": len(text), "sha256": hashlib.sha256(document["data"]).hexdigest(), "bytes": len(document["data"]), "truncated": len(text) < len(reader.pages) or chars > 500000}}
    except SourceFailure:
        raise
    except Exception as error:
        raise SourceFailure("CRAWL_PDF_INVALID", "来源 PDF 无法解析，未取得有效正文") from error


def network_failure(error):
    if isinstance(error, (asyncio.TimeoutError, aiohttp.ServerTimeoutError)):
        return SourceFailure("CRAWL_TIMEOUT", "来源读取超时，未取得正文", retryable=True)
    if isinstance(error, aiohttp.ClientConnectorDNSError):
        return SourceFailure("CRAWL_DNS_FAILED", "来源域名解析失败", retryable=True)
    return SourceFailure("CRAWL_NETWORK_FAILED", "来源连接中断，未取得完整正文", retryable=True)


async def capture_page(url, screenshot, browser_capture):
    result, http_failure = None, None
    pdf_document = False
    is_pdf_url = urlparse(url).path.lower().endswith(".pdf")
    try:
        document = await fetch_document(url)
        pdf_document = document["pdf"]
        if document["pdf"]:
            return await asyncio.wait_for(asyncio.to_thread(extract_pdf, document), timeout=15)
        if document["contentType"] not in ("", "text/html", "application/xhtml+xml", "text/plain"):
            raise SourceFailure("CRAWL_UNSUPPORTED_TYPE", "来源不是支持的网页或 PDF 文档", document["httpStatus"])
        if document["contentType"] == "text/plain":
            result = {"url": document["url"], "title": urlparse(document["url"]).hostname, "markdown": document["data"].decode(document["charset"], errors="replace")[:500000], "html": "", "media": {}, "screenshot": None, "captureMethod": "http-text", "httpStatus": document["httpStatus"], "sourceFormat": "text", "screenshotStatus": "not_applicable"}
            screenshot = False
        else:
            result = await asyncio.to_thread(extract_html, document)
        if len(result["markdown"].strip()) < MIN_TEXT_CHARS:
            result = None
    except SourceFailure as error:
        if is_pdf_url or pdf_document or error.detail["code"] in ("CRAWL_CHALLENGE", "CRAWL_INVALID_URL", "CRAWL_BLOCKED", "CRAWL_RATE_LIMITED", "CRAWL_NOT_FOUND", "CRAWL_UNSUPPORTED_TYPE", "CRAWL_DOCUMENT_TOO_LARGE") or error.detail["code"].startswith("CRAWL_PDF_"):
            raise
        http_failure = error
    except (asyncio.TimeoutError, aiohttp.ClientError) as error:
        http_failure = network_failure(error)
        if is_pdf_url or pdf_document:
            raise http_failure from error
    if result is not None and not screenshot:
        return result
    try:
        try:
            browser = await asyncio.wait_for(browser_capture(url, screenshot), timeout=45)
        except asyncio.TimeoutError as error:
            raise SourceFailure("CRAWL_TIMEOUT", "浏览器读取或截图超时", retryable=True) from error
        if browser.get("html") and challenge_page(browser["html"]):
            raise SourceFailure("CRAWL_CHALLENGE", "浏览器页面要求验证码，未取得有效截图")
        if result is not None:
            # Screenshot acquisition cannot overwrite or invalidate good HTTP text.
            result["screenshot"] = browser.get("screenshot")
            result["screenshotStatus"] = "captured" if browser.get("screenshot") else "failed"
            result["captureMethod"] += "+browser-screenshot"
            return result
        rendered = extract_html({"url": browser.get("url", url), "data": browser.get("html", "").encode(), "charset": "utf-8", "httpStatus": browser.get("httpStatus", 200)})
        markdown = rendered["markdown"] or browser.get("markdown", "")
        if len(markdown.strip()) < MIN_TEXT_CHARS:
            raise SourceFailure("CRAWL_EMPTY_TEXT", "网页未返回足够的可读正文，保留来源链接等待补查")
        return {**browser, "markdown": markdown, "title": rendered["title"] or browser.get("title", ""), "captureMethod": "browser-trafilatura" if rendered["markdown"] else "browser-crawl4ai", "sourceFormat": "html", "screenshotStatus": "captured" if browser.get("screenshot") else "failed" if screenshot else "not_requested", "captureWarnings": [http_failure.detail] if http_failure else []}
    except SourceFailure as error:
        if result is None:
            raise
        result["screenshotStatus"] = "failed"
        result["captureWarnings"] = [error.detail]
        return result
