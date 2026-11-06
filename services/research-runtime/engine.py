import asyncio
import base64
from contextlib import aclosing, redirect_stdout
import json
import os
from pathlib import Path
import shutil
import sys
from runtime_contracts import install_gptr_single_attempt, load_proposal_bundle, public_proposal_event, raise_proposal_model_failure

folder = Path(sys.argv[1]).resolve()
body = json.loads((folder / "input.json").read_text(encoding="utf-8"))
gateway = body["gatewayUrl"].rstrip("/")
token = body["gatewayToken"]
model = body["model"]
engine = os.environ["RESEARCH_ENGINE"]
outputs = folder / "outputs"
outputs.mkdir(exist_ok=True)
protocol_output = sys.stdout
os.environ.update({"OPENAI_API_KEY": token, "OPENAI_BASE_URL": gateway + "/v1", "LANGSMITH_TRACING": "false", "LANGCHAIN_TRACING_V2": "false", "OTEL_SDK_DISABLED": "true"})


def emit(kind, data):
    print(json.dumps({"type": kind, "data": data}, ensure_ascii=False), file=protocol_output, flush=True)


async def tool(kind, payload):
    import httpx
    async with httpx.AsyncClient(timeout=100, trust_env=False) as client:
        response = await client.post(gateway + "/" + kind, headers={"Authorization": "Bearer " + token}, json=payload)
        response.raise_for_status()
        return response.json()


class ChugaoRetriever:
    def __init__(self, query, *args, **kwargs):
        self.query = query

    def search(self, max_results=5, **kwargs):
        import httpx
        response = httpx.post(gateway + "/search", headers={"Authorization": "Bearer " + token}, json={"query": self.query}, timeout=65, trust_env=False)
        if response.status_code == 409 and "STAGE_BUDGET_RESERVED" in response.text:
            emit("activity", {"message": "搜索额度已留给后续核验，停止扩展新检索"})
            return []
        response.raise_for_status()
        return [{"href": item["url"], "body": item.get("content", ""), "title": item.get("title", "")} for item in response.json().get("results", [])[:max_results]]


async def gptr():
    os.environ.update({"FAST_LLM": "openai:" + model, "SMART_LLM": "openai:" + model, "STRATEGIC_LLM": "openai:" + model, "LANGUAGE": "chinese", "RETRIEVER": "custom", "IMAGE_GENERATION_ENABLED": "false", "REASONING_EFFORT": "high", "CONTEXT_FILTER": "keyword"})
    from gpt_researcher import GPTResearcher
    from gpt_researcher.skills.browser import BrowserManager
    import gpt_researcher.retrievers as retriever_registry
    from design_research import (
        CONTEXT_FILTER, CONTRACT_VERSION, DESIGN_AGENT, MODEL_PURPOSE,
        bind_task_messages, call_purpose, digest, install_design_pipeline, make_task_spec,
        model_purpose, research_role, validate_stage_response, writer_prompt,
    )

    task_spec = make_task_spec(body)
    task_hash = digest(task_spec)
    from runtime_contracts import CompletedModelCache
    previous_runs = body.get("previousRunIds", [])
    model_cache = CompletedModelCache(folder, {
        "taskSpecHash": task_hash, "model": model, "effort": body.get("effort"),
        "runtimeContract": CONTRACT_VERSION,
    }, previous_runs if isinstance(previous_runs, list) else [])
    writer_selection = None
    context_selections = []
    model_failure = None

    def remember_failure(error):
        nonlocal model_failure
        model_failure = error

    def record_manifest(manifest):
        # Retain offsets and hashes for the actual selected source text. The
        # model body is deliberately absent from public activity metadata.
        context_selections.append(manifest)
        path = folder / "gptr-context-selections.json"
        path.write_text(json.dumps(context_selections, ensure_ascii=False), encoding="utf-8")
        emit("activity", {"message": "已按当前设计任务选择原文片段", "contextFilter": CONTEXT_FILTER, "contextManifest": manifest})

    def call_metadata(module_name, function_name):
        purpose = call_purpose(module_name, function_name)
        return {
            "runtimeContract": CONTRACT_VERSION, "purpose": purpose,
            "taskSpecHash": task_hash, "contextFilter": CONTEXT_FILTER,
            **({"contextHash": writer_selection["manifest"]["contextHash"]} if writer_selection and purpose == "research.write_report" else {}),
        }

    patched_helpers = install_gptr_single_attempt(
        lambda value: emit("activity", {"message": "复用已完成的模型步骤" if value.get("cacheHit") else "研究模型执行当前阶段任务", "modelCall": value}),
        metadata_provider=call_metadata,
        prepare_messages=lambda messages: bind_task_messages(messages, task_spec),
        finish_response=validate_stage_response,
        on_failure=remember_failure,
        response_cache=model_cache,
    )
    selector, restore_pipeline = install_design_pipeline(task_spec, record_manifest)
    emit("activity", {"message": "设计研究任务已固定；使用可追溯的中文词项选材，外层模型重放已关闭", "runtimeContract": CONTRACT_VERSION, "contextFilter": CONTEXT_FILTER, "embeddingUsed": False, "helperReferences": patched_helpers, "taskSpecHash": task_hash})

    saved_sources = {}
    for source in body.get("evidence", []):
        if not isinstance(source, dict) or source.get("status") not in ("captured", "provided") or source.get("contentKind") not in ("captured_text", "user_provided_text") or not source.get("content"):
            continue
        url = source.get("url") or "urn:chugao:evidence:" + str(source.get("id", len(saved_sources)))
        quality = source.get("quality") if isinstance(source.get("quality"), dict) else {}
        saved_sources[url] = {
            "url": url, "evidenceId": source.get("id"),
            "title": source.get("title", ""), "raw_content": source["content"],
            "contentKind": source["contentKind"], "quality": quality,
            "routing": source.get("routing") or quality.get("routing", {}),
            # Worker evidence may be a stitched excerpt, not the retained body.
            "textScope": "supplied_snippets",
            **{key: source[key] for key in ("contentHash", "contentRanges", "capturedChars", "truncated", "contextInclusion") if key in source},
        }
    attempted_urls = set()

    class Browser(BrowserManager):
        async def browse_urls(self, urls):
            sources = []
            for url in urls[:body.get("maxPages", 12)]:
                try:
                    if url in saved_sources:
                        sources.append(saved_sources[url])
                        emit("activity", {"message": "复用已保存的网页资料", "url": url})
                        continue
                    if url in attempted_urls:
                        continue
                    attempted_urls.add(url)
                    page = await tool("crawl", {"url": url, "screenshot": False})
                    if not str(page.get("markdown", "")).strip():
                        emit("activity", {"message": "网页未取得可用正文，保留采集状态", "url": url})
                        continue
                    quality = page.get("quality") if isinstance(page.get("quality"), dict) else {}
                    routing = page.get("routing") or quality.get("routing") or {}
                    if quality.get("decision") == "reject" and not routing:
                        routing = {"method": "heuristic", "role": "irrelevant", "decisionIds": [], "reason": "Existing source triage rejected this page; explicit user URLs remain reviewable"}
                    source = {
                        "url": url, "evidenceId": page.get("evidenceId") or page.get("id"),
                        "title": page.get("title", ""), "raw_content": page["markdown"],
                        "contentKind": "captured_text", "quality": quality, "routing": routing,
                    }
                    # Child passes reuse the retained body, not just a visited
                    # marker that silently removes the page from their context.
                    saved_sources[url] = source
                    sources.append(source)
                except Exception as error:
                    response = getattr(error, "response", None)
                    if getattr(response, "status_code", None) == 409 and "STAGE_BUDGET_RESERVED" in response.text:
                        emit("activity", {"message": "已保留核验采集额度，使用已有材料继续整理"})
                        break
                    emit("activity", {"message": "网页采集失败，保留来源链接", "url": url})
                    if getattr(getattr(error, "response", None), "status_code", None) in (401, 403, 409):
                        raise
            self.researcher.add_research_sources(sources)
            return sources

    class Sink:
        async def send_json(self, value):
            if value.get("type") == "report":
                if MODEL_PURPOSE.get() == "research.write_report":
                    emit("text", {"delta": str(value.get("output", "")), "purpose": "research.write_report"})
            elif value.get("type") == "logs":
                emit("activity", {"message": str(value.get("content", "正在研究资料"))[:200]})

    # Apply the same controlled tools to child researchers created by deep mode.
    retriever_registry.CustomRetriever = ChugaoRetriever
    BrowserManager.browse_urls = Browser.browse_urls

    # The gateway applies the task's actual effort; GPTR accepts only its own narrower enum here.
    config = {"RETRIEVER": "custom", "FAST_LLM": "openai:" + model, "SMART_LLM": "openai:" + model, "STRATEGIC_LLM": "openai:" + model, "LANGUAGE": "chinese", "CONTEXT_FILTER": "keyword", "CURATE_SOURCES": False, "AGENT_ROLE": research_role(task_spec), "MCP_STRATEGY": "disabled", "MAX_ITERATIONS": 2, "MAX_SEARCH_RESULTS_PER_QUERY": 4, "MAX_SUBTOPICS": 3, "MAX_SCRAPER_WORKERS": 1, "DEEP_RESEARCH_BREADTH": 2, "DEEP_RESEARCH_DEPTH": 2 if body.get("scope") == "deep" else 1, "DEEP_RESEARCH_CONCURRENCY": 1, "LLM_KWARGS": {"max_retries": 0}, "REASONING_EFFORT": "high", "IMAGE_GENERATION_ENABLED": False, "TOTAL_WORDS": 1800 if body.get("scope") == "deep" else 800, "SMART_TOKEN_LIMIT": 10000 if body.get("scope") == "deep" else 6000}
    config_file = folder / "gptr.json"
    config_file.write_text(json.dumps(config), encoding="utf-8")
    planned = [item for item in body.get("searchPlan", []) if isinstance(item, dict) and isinstance(item.get("query"), str) and item["query"].strip()]
    # A research objective is not itself a search-engine query. Seed several small
    # decision-oriented queries; the gateway also validates every later query.
    # query remains the original objective: it is reused inside GPTR's internal
    # JSON tasks. TaskSpec and writer format have their own explicit contracts.
    researcher = GPTResearcher(query=task_spec["objective"], agent=DESIGN_AGENT, role=research_role(task_spec), report_type="deep" if body.get("scope") == "deep" and not body.get("links") else "research_report", config_path=str(config_file), source_urls=body.get("links") or None, complement_source_urls=True, websocket=Sink(), verbose=False, max_subtopics=3, mcp_strategy="disabled")
    researcher.retrievers = [ChugaoRetriever]
    researcher.scraper_manager = Browser(researcher)
    if os.environ.get("RESEARCH_CHECK_ONLY") == "1":
        emit("result", {"ready": True, "engine": "gpt-researcher", "runtimeContract": CONTRACT_VERSION, "contextFilter": CONTEXT_FILTER, "embeddingUsed": False, "taskSpecHash": task_hash, "fixedAgent": researcher.agent})
        restore_pipeline()
        return
    # Seed the real researcher with distinct, bounded queries before its own
    # adaptive planning. All searches/crawls still pass through the durable ledger.
    seed_urls = list(body.get("links") or [])
    for item in planned[:4]:
        try:
            found = await tool("search", {"query": item["query"], "purpose": item.get("purpose", "")})
            for candidate in found.get("results", [])[:3]:
                if candidate.get("url") not in seed_urls:
                    seed_urls.append(candidate["url"])
        except Exception as error:
            response = getattr(error, "response", None)
            if getattr(response, "status_code", None) == 409 and "STAGE_BUDGET_RESERVED" in response.text:
                break
            raise
    if seed_urls:
        researcher.source_urls = seed_urls[:12]
    try:
        with model_purpose("research.conduct"):
            await researcher.conduct_research()
        if model_failure is not None:
            raise RuntimeError("Research model failed inside the framework; retained sources must be reviewed before an explicit retry") from model_failure
        # GPTR's conductor replaces constructor context. The writer therefore
        # receives original retained materials selected against the fixed task;
        # it never silently inherits a drifted intermediate summary.
        collected = list(saved_sources.values())
        collected.extend(source for source in researcher.get_research_sources() if source.get("url") not in saved_sources)
        writer_selection = selector.select(collected, purpose="research.write_report")
        record_manifest(writer_selection["manifest"])
        prompt = writer_prompt(task_spec)
        (folder / "gptr-writer-input.json").write_text(json.dumps({
            "runtimeContract": CONTRACT_VERSION, "taskSpec": task_spec,
            "customPrompt": prompt, "context": writer_selection["context"],
            "manifest": writer_selection["manifest"],
        }, ensure_ascii=False), encoding="utf-8")
        result_trace = {
            "runtimeContract": CONTRACT_VERSION, "taskSpecHash": task_hash,
            "contextFilter": CONTEXT_FILTER, "embeddingUsed": False,
            "writerContextManifest": writer_selection["manifest"],
            "writerEvidenceIds": [source["id"] for source in writer_selection["sources"]],
        }
        if not writer_selection["sources"]:
            emit("result", {"text": "本阶段未取得可纳入当前设计任务的原文片段。已保存候选来源、选材区间与未纳入原因；后续核验可使用预留额度补查。", "sources": collected, "materialGate": "insufficient", **result_trace})
            return
        with model_purpose("research.write_report"):
            report = await researcher.write_report(ext_context=writer_selection["context"], custom_prompt=prompt)
        # The pinned framework can swallow its last report error and return "".
        # Partial streamed text is already retained; an empty report is not completion.
        if not isinstance(report, str) or not report.strip():
            raise RuntimeError("Research framework returned no completed report; partial output was retained")
        emit("result", {"text": report, "sources": collected, **result_trace})
    finally:
        restore_pipeline()


async def deerflow():
    import yaml
    import httpx
    from deerflow.agents.lead_agent.agent import make_lead_agent
    from deerflow.runtime.user_context import set_current_user, resolve_runtime_user_id
    from types import SimpleNamespace

    # Embedded runs do not pass through DeerFlow's HTTP authentication middleware.
    set_current_user(SimpleNamespace(id="chugao"))

    home = folder / "deerflow"
    project_root = Path(os.environ.get("CHUGAO_DEERFLOW_ROOT", "/opt/deerflow")).resolve()
    skills_root = Path(__file__).resolve().parent / "skills"
    os.environ.update({"DEER_FLOW_HOME": str(home), "DEER_FLOW_DATE_TIMEZONE": "Asia/Shanghai", "DEER_FLOW_PROJECT_ROOT": str(project_root), "DEER_FLOW_SKILLS_PATH": str(skills_root)})
    config = yaml.safe_load((project_root / "config.example.yaml").read_text())
    config["models"] = [{"name": "chugao", "display_name": "Chugao", "use": "langchain_openai:ChatOpenAI", "model": model, "base_url": gateway + "/v1", "api_key": token, "max_retries": 0, "max_tokens": 6000, "supports_thinking": False, "supports_vision": False}]
    # The framework middleware has its own retry loop in addition to ChatOpenAI.
    # Keep one model-boundary attempt; only Chugao's gateway owns retry policy.
    config["llm_call"] = {**config.get("llm_call", {}), "retry_max_attempts": 1}
    config["sandbox"] = {"use": "deerflow.sandbox.local:LocalSandboxProvider", "allow_host_bash": False}
    config["memory"] = {"enabled": False, "injection_enabled": False}
    config["skills"] = {"path": str(skills_root), "container_path": "/mnt/skills"}
    config["tools"] = [entry for entry in config.get("tools", []) if entry.get("group") == "file:read"]
    config["tool_groups"] = [{"name": name} for name in ("file:read", "file:write")]
    config["tools"] += [{"name": "chugao_create_proposal", "group": "file:write", "use": "chugao_tools:chugao_create_proposal"}]
    config["extensions"] = {"middlewares": []}
    config.pop("plugins", None)
    config_file = folder / "deerflow.yaml"
    config_file.write_text(yaml.safe_dump(config, allow_unicode=True), encoding="utf-8")
    os.environ["DEER_FLOW_CONFIG_PATH"] = str(config_file)
    os.environ["CHUGAO_GATEWAY_URL"] = gateway
    os.environ["CHUGAO_GATEWAY_TOKEN"] = token
    thread_id = body["runId"]
    from deerflow.config.paths import get_paths
    paths = get_paths()
    paths.ensure_thread_dirs(thread_id, user_id="chugao")
    uploads = paths.sandbox_uploads_dir(thread_id, user_id="chugao")
    uploads.mkdir(parents=True, exist_ok=True)
    os.environ["CHUGAO_PROPOSAL_INPUT"] = str(folder / "input.json")
    os.environ["CHUGAO_PROPOSAL_OUTPUTS"] = str(paths.sandbox_outputs_dir(thread_id, user_id="chugao"))
    (uploads / "research.md").write_text(body.get("research", ""), encoding="utf-8")
    (uploads / "evidence.json").write_text(json.dumps(body.get("evidence", []), ensure_ascii=False), encoding="utf-8")
    (uploads / "brief.json").write_text(json.dumps(body.get("brief", {}), ensure_ascii=False), encoding="utf-8")
    (uploads / "final-research-package.json").write_text(json.dumps(body.get("finalResearchPackage"), ensure_ascii=False), encoding="utf-8")
    package = body.get("finalResearchPackage") or {}
    (uploads / "proposal-data.json").write_text(json.dumps({
        "package_version": package.get("version"),
        "finalBrief": package.get("finalBrief"),
        "hypotheses": package.get("hypotheses"),
        "competitors": package.get("competitors"),
        "quality": package.get("quality"),
        "caveats": package.get("caveats"),
        "evidence": [{key: source.get(key) for key in ("id", "title", "url", "status", "contentKind", "sourceAvailability")} for source in package.get("evidence", [])],
        "notice": "Exact same-version projection. Read evidence.json before making observations; source metadata alone is not original text.",
    }, ensure_ascii=False), encoding="utf-8")
    for file in body.get("files", []):
        name = Path(file["name"]).name
        (uploads / name).write_bytes(base64.b64decode(file["data"]))
    # Graph steps include every middleware hook, not just model invocations.
    # Actual model calls are separately bounded by Chugao's gateway ledger.
    run_config = {"configurable": {"thread_id": thread_id, "user_id": "chugao", "model_name": "chugao", "subagent_enabled": False, "thinking_enabled": False, "is_plan_mode": False, "non_interactive": True}, "recursion_limit": min(body.get("maxCalls", 30) * 100 + 100, 20000)}
    run_context = {"thread_id": thread_id, "user_id": "chugao"}
    if resolve_runtime_user_id(SimpleNamespace(context=run_context, config=run_config)) != "chugao":
        raise RuntimeError("Proposal runtime identity does not match its file storage")
    graph = make_lead_agent(run_config)
    from deerflow.sandbox import get_sandbox_provider
    provider = get_sandbox_provider()
    sandbox = provider.get(provider.acquire(thread_id, user_id="chugao"))
    skill_path = "/mnt/skills/public/proposal/SKILL.md"
    if not sandbox or "python-pptx" not in sandbox.read_file(skill_path):
        raise RuntimeError("Proposal skill is unavailable in the sandbox")
    if sandbox.read_file("/mnt/user-data/uploads/research.md") != body.get("research", ""):
        raise RuntimeError("Research inputs were not mounted into the sandbox")
    trusted_outputs = paths.sandbox_outputs_dir(thread_id, user_id="chugao")
    trusted_outputs.mkdir(parents=True, exist_ok=True)
    (trusted_outputs / "preflight.txt").write_text("ok", encoding="utf-8")
    if sandbox.read_file("/mnt/user-data/outputs/preflight.txt") != "ok":
        raise RuntimeError("Sandbox file generation preflight failed")
    if os.environ.get("RESEARCH_CHECK_ONLY") == "1":
        emit("result", {"ready": True, "engine": "deerflow"})
        return
    package = body.get("finalResearchPackage")
    if not isinstance(package, dict) or not package.get("version"):
        raise RuntimeError("A locked final research package is required for production")
    prompt = (
        "你是 Chugao 的提案制作执行器。先读取 /mnt/skills/public/proposal/SKILL.md 和 /mnt/user-data/uploads/proposal-data.json。"
        "proposal-data 是唯一终稿包的同版本精确字段投影，可直接复制需求、假设原文和依据。完整版本在 /mnt/user-data/uploads/final-research-package.json；"
        "需要提出来源记载时，先读取 /mnt/user-data/uploads/evidence.json 的原文片段。只看到元数据不能声称已读原文。不要重新搜索，不让旧假设复活。"
        "调用 chugao_create_proposal，contract_version=2，package_version 与投影完全一致。使用 overview/comparison/process/tradeoffs/evidence 布局，共用 slides，禁止旧 points/sections。"
        "用户需求只能逐字复制 finalBrief.confirmedRequirements；hypothesis claim 的 text 和 assumption_basis 必须逐字复制同一个 hypothesis 的 text 和 basis，不能概括、缩写或改写。"
        "材料不足就使用 draft，不能自称 verified。保留 caveats。使用原生表格比较候选路线、形状表达过程。不要安装依赖、扫描字体、编写脚本或遍历文件。"
        "工具确认写入清单后任务即结束，不需要再调用 ls 或 present_files。需要格式："
        + json.dumps(body.get("products", []), ensure_ascii=False)
    )
    async with aclosing(graph.astream_events({"messages": [{"role": "user", "content": prompt}], "title": "Chugao proposal"}, config=run_config, context=run_context, version="v2")) as events:
        async for event in events:
            raise_proposal_model_failure(event)
            public = public_proposal_event(event)
            if public:
                emit(*public)
            if event.get("event") == "on_tool_end" and event.get("name") == "chugao_create_proposal":
                try:
                    load_proposal_bundle(trusted_outputs, package["version"])
                except ValueError:
                    continue
                break
    manifest, selected_files = load_proposal_bundle(trusted_outputs, package["version"])
    for file in selected_files:
        shutil.copy2(file, outputs / file.name)
    expected = {"pptx": ".pptx", "docx": ".docx", "html": ".html"}
    for product in body.get("products", []):
        if product in expected and not list(outputs.glob("*" + expected[product])):
            raise RuntimeError("Requested artifact was not produced: " + product)
    for file in outputs.iterdir():
        if file.suffix.lower() == ".pptx":
            from pptx import Presentation
            if not Presentation(file).slides:
                raise RuntimeError("Presentation contains no editable slides")
        elif file.suffix.lower() == ".docx":
            from docx import Document
            document = Document(file)
            if not document.paragraphs and not document.tables:
                raise RuntimeError("Document is empty")
        elif file.suffix.lower() == ".html":
            from bs4 import BeautifulSoup
            if not BeautifulSoup(file.read_text(encoding="utf-8"), "html.parser").get_text(strip=True):
                raise RuntimeError("Webpage is empty")
    emit("result", {"files": [file.name for file in selected_files], "text": "已生成本次终稿版本的可编辑文件。" + ("当前为研究草稿，待验证项已保留。" if manifest["status"] == "draft" else "自动材料门槛满足，结论仍需核验。"), "packageVersion": package["version"], "evidenceIds": manifest.get("evidence_ids", []), "artifactManifest": [{**entry, "name": Path(entry["path"]).name} for entry in manifest["files"]]})


async def main():
    if engine == "gpt-researcher":
        await gptr()
    elif engine == "deerflow":
        await deerflow()
    else:
        raise RuntimeError("Unsupported engine")


if __name__ == "__main__":
    # Framework diagnostics may contain entire scraped pages; stdout is only NDJSON events.
    with redirect_stdout(sys.stderr):
        asyncio.run(main())
