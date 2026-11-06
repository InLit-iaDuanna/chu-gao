"""Real GPTR 0.16.1/LangChain contracts with synthetic HTTP; no live models.

The engine tests run the actual entry point, framework, provider, HTTP client,
and stream decoder. Only the HTTP transports are replaced. Predetermined model
text tests input/lineage contracts; it is not a claim about research quality on
an untested live provider.
"""
from contextlib import ExitStack, redirect_stderr, redirect_stdout
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path
import runpy
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

RUNTIME = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME))
from design_research import (
    CONTEXT_FILTER, CONTRACT_VERSION, DESIGN_AGENT, DesignMaterialSelector,
    bind_task_messages, canonical_json, digest, install_design_pipeline,
    lexical_tokens, make_task_spec, research_role, validate_stage_response, writer_prompt,
)


def task(**overrides):
    value = {
        "query": "办公场景轻食机的清洗与加水流程如何设计？",
        "taskSpec": {
            "schemaVersion": 1,
            "objective": "办公场景轻食机的清洗与加水流程如何设计？",
            "confirmedRequirements": ["用户原话 REQ-X17：不要将办公室适用性写成已验证事实。"],
            "decisionQuestions": [{"id": "cleaning", "question": "水箱拆卸和清洗步骤是否影响使用？"}],
        },
        "links": [],
    }
    value.update(overrides)
    return value


def source(identifier, text, role="pending", **overrides):
    return {
        "evidenceId": identifier, "url": f"https://sources.invalid/{identifier}",
        "title": identifier, "raw_content": text, "contentKind": "captured_text",
        "routing": {"method": "heuristic", "role": role, "decisionIds": [], "reason": "Synthetic source routing"},
        **overrides,
    }


class LocalSelectionTests(unittest.TestCase):
    def setUp(self):
        self.spec = make_task_spec(task())
        self.selector = DesignMaterialSelector(self.spec)

    def test_chinese_local_ranking_fixes_the_real_pinned_zero_overlap_without_embeddings(self):
        from gpt_researcher.context import lexical
        question = "办公室午餐使用轻食机时，水箱是否容易拆洗？"
        passages = ["轻食机使用后应拆出水箱冲洗，并检查密封圈。", "餐车网站提供响应式导航栏。"]
        self.assertEqual(lexical.bm25_scores(question, passages), [0.0, 0.0])
        scores = self.selector.score(question, passages)
        self.assertGreater(scores[0], 0)
        self.assertEqual(scores[1], 0)
        self.assertNotIn("mr90860", lexical_tokens("MR9086"))
        self.assertEqual(set(lexical_tokens("MR9086")) & set(lexical_tokens("MR90860")), set())
        self.assertEqual(lexical_tokens("https://example.invalid/轻食机/MR9086"), [])

    def test_real_long_document_late_evidence_and_exact_original_offsets(self):
        header = ("关于企业的组织介绍及历史沿革。\n" * 3000)
        body = header + "\n轻食机的可拆卸水箱需要逐件冲洗。LATE-EVIDENCE-Z52 拆卸步骤不能省略。\n" + ("售后联系说明。\n" * 100)
        page = source("long-manual", body, "constraint")
        selected = self.selector.select([page])
        self.assertIn("LATE-EVIDENCE-Z52", selected["context"])
        row = selected["manifest"]["sources"][0]
        self.assertTrue(any(item["start"] >= len(header) - 1100 for item in row["ranges"]))
        self.assertEqual(row["contentHash"], hashlib.sha256(body.encode()).hexdigest())
        self.assertEqual(row["originalChars"], len(body))
        for span in row["ranges"]:
            actual = body[span["start"]:span["end"]]
            self.assertEqual(hashlib.sha256(actual.encode()).hexdigest(), span["sha256"])
        self.assertLessEqual(row["includedChars"], 3300)

    def test_manifest_and_writer_read_exactly_the_same_budgeted_material(self):
        pages = [source(f"manual-{i}", (f"轻食机水箱拆卸步骤{i}。🙂清洗位置需检查。\n" * 130), "constraint") for i in range(20)]
        selector = DesignMaterialSelector(self.spec, max_chars=5200, max_sources=10)
        selected = selector.select(pages, purpose="research.write_report")
        manifest = selected["manifest"]
        self.assertLessEqual(len(selected["context"]), 5200)
        self.assertEqual(manifest["usedChars"], len(selected["context"]))
        self.assertEqual(manifest["contextHash"], hashlib.sha256(selected["context"].encode()).hexdigest())
        self.assertEqual(manifest["budgetUnit"], "unicode_codepoints_json")
        self.assertEqual(json.loads(selected["context"])["sources"], selected["sources"])
        originals = {page["evidenceId"]: page["raw_content"] for page in pages}
        selected_ids = {page["id"] for page in selected["sources"]}
        for entry in manifest["sources"]:
            self.assertEqual(bool(entry["ranges"]), entry["id"] in selected_ids)
        for entry in selected["sources"]:
            reconstructed = "\n[…省略原文…]\n".join(originals[entry["id"]][span["start"]:span["end"]] for span in entry["ranges"])
            self.assertEqual(entry["content"], reconstructed)
            self.assertEqual(entry["authority"], "unverified")

    def test_identified_sku_and_user_selected_source_survive_zero_overlap_but_irrelevance_does_not(self):
        spec = make_task_spec(task(links=["https://sources.invalid/user-file"]))
        selected = DesignMaterialSelector(spec).select([
            source("sku", "Model MR9086. Capacity 800 mL. Power 900 W.", "product_identity"),
            source("user-file", "USER-SOURCE-FIXTURE: previously supplied unusual material.", "irrelevant"),
            source("truck", "轻食机网页设计导航。EXPLICIT-IRRELEVANT-TRUCK", "irrelevant"),
            source("unknown", "Unrecognized category ZQ777: needs later review.", "pending"),
        ])
        ids = {entry["id"] for entry in selected["sources"]}
        self.assertEqual(ids, {"sku", "user-file"})
        entries = {entry["id"]: entry for entry in selected["manifest"]["sources"]}
        self.assertTrue(entries["user-file"]["userSelected"])
        self.assertEqual(entries["truck"]["omittedReason"], "explicit_irrelevance")
        self.assertEqual(entries["unknown"]["omittedReason"], "no_task_match_pending_review")

    def test_background_volume_and_duplicate_urls_cannot_fill_the_writer_budget(self):
        pages = [source(f"background-{i}", f"轻食机市场背景说明{i}。" * 180, "background") for i in range(6)]
        pages += [source("manual", "轻食机水箱拆洗说明。事实应保留条件。" * 60, "constraint")]
        pages += [source("duplicate", "DIFFERENT BODY MUST NOT DUPLICATE URL", url="https://sources.invalid/manual#section")]
        selected = self.selector.select(pages)
        backgrounds = [entry for entry in selected["sources"] if entry["role"] == "background"]
        self.assertLessEqual(len(backgrounds), 2)
        self.assertIn("manual", {entry["id"] for entry in selected["sources"]})
        self.assertEqual(selected["manifest"]["sources"][-1]["omittedReason"], "duplicate")

    def test_complete_same_task_process_and_disclosure_survive_repeated_footer_keywords(self):
        body = (
            "# 三明治机体验\n## 使用体验\n"
            "先用三分钟准备鸡蛋与午餐肉，同时预热。\n"
            "![轻食机办公室清洗：图片 alt 不应重复增加词项权重](https://example.invalid/image.jpg)\n"
            "馅料再加热三分钟，随后放入面包片。\n"
            "又烤三分钟，前后花了9分钟左右；不是只需三分钟。\n"
            "本文商品由测试平台提供，并邀请用户撰写评测报告。\n"
            "#### 相关文章推荐\n"
            + ("[轻食机 办公室 清洗加水 智能购物管家无关推荐](https://example.invalid/promo)\n" * 120)
            + "## 更多界面\n签到二维码。FOOTER-CONTAMINATION。\n"
        )
        selected = self.selector.select([source("review", body, "alternative")])
        text = selected["sources"][0]["content"]
        for expected in ("先用三分钟", "馅料再加热三分钟", "前后花了9分钟", "本文商品由测试平台提供"):
            self.assertIn(expected, text)
        self.assertNotIn("FOOTER-CONTAMINATION", text)
        self.assertNotIn("无关推荐", text)
        self.assertNotIn("image.jpg", text)
        for span in selected["manifest"]["sources"][0]["ranges"]:
            self.assertLess(span["end"], body.index("#### 相关文章推荐"))
        # A user-authored source can legitimately discuss such a UI heading;
        # web boilerplate heuristics must not erase the user's supplied text.
        supplied = self.selector.select([source("provided", body, contentKind="user_provided_text")])
        self.assertEqual(supplied["manifest"]["sources"][0]["sourceTextPolicy"], "user-provided-text")

    def test_task_constraints_are_not_promoted_from_model_suggestions_or_lost_in_json_tasks(self):
        fallback = make_task_spec({"query": "真实对象 SENTINEL-91", "brief": {"constraints": "助手建议功率 900 W"}})
        self.assertEqual(fallback["confirmedRequirements"], [])
        original = [{"role": "user", "content": 'Return ONLY JSON: {"questions": ["..."]}'}]
        prepared = bind_task_messages(original, self.spec)
        self.assertEqual(prepared[1], original[0])
        self.assertEqual(len(original), 1)
        self.assertIn("REQ-X17", prepared[0]["content"])
        self.assertNotIn("Markdown", prepared[0]["content"])
        self.assertEqual(bind_task_messages(prepared, self.spec), prepared)
        self.assertIn(self.spec["objective"], writer_prompt(self.spec))
        self.assertIn("REQ-X17", writer_prompt(self.spec))
        with self.assertRaisesRegex(ValueError, "confirmedRequirements"):
            make_task_spec(task(taskSpec={"objective": "x", "confirmedRequirements": "suggestion"}))

    def test_saved_decision_route_cannot_apply_to_changed_source_bytes(self):
        page = source("changed", "轻食机水箱清洗的新版本记录。", routing={
            "method": "model_review", "role": "constraint", "decisionIds": ["cleaning"],
            "reason": "Old review", "contentHash": "a" * 64,
        })
        selected = self.selector.select([page])
        self.assertEqual(selected["sources"][0]["role"], "pending")
        self.assertEqual(selected["sources"][0]["routing"]["decisionIds"], [])
        self.assertIn("different retained bytes", selected["sources"][0]["routing"]["reason"])

    def test_stitched_snippets_keep_utf16_parents_without_claiming_original_hash_or_offsets(self):
        first = "轻食机🙂水箱拆卸条件。SNIPPET-FIRST。"
        second = "轻食机清洗后的密封圈需检查。SNIPPET-SECOND。"
        original = "🙂未提供的前文。" * 30 + first + "未提供的中间原文。" * 40 + second
        utf16 = lambda value: len(value.encode("utf-16-le")) // 2
        parents = [{"start": utf16(original[:original.index(value)]),
                    "end": utf16(original[:original.index(value) + len(value)])} for value in (first, second)]
        snippet = "\n[…省略原文…]\n" + first + "\n[…省略原文…]\n" + second
        parent_hash = hashlib.sha256(original.encode()).hexdigest()
        page = source("stitched", snippet, "constraint", contentHash=parent_hash,
                      contentRanges=parents, capturedChars=utf16(original), truncated=True, contextInclusion="excerpt",
                      routing={"method": "model_review", "role": "constraint", "decisionIds": ["cleaning"],
                               "reason": "Review of declared parent version", "contentHash": parent_hash})
        selected = self.selector.select([page])
        row = selected["manifest"]["sources"][0]
        packed = selected["sources"][0]
        for entry in (row, packed):
            self.assertEqual(entry["textScope"], "supplied_snippets")
            self.assertIsNone(entry["contentHash"])
            self.assertIsNone(entry["originalChars"])
            self.assertEqual(entry["snippetHash"], hashlib.sha256(snippet.encode()).hexdigest())
            self.assertEqual(entry["snippetChars"], len(snippet))
            self.assertEqual(entry["rangeCoordinateSystem"], "supplied_snippets_unicode_codepoints")
            self.assertEqual(entry["offsetUnit"], "unicode_codepoints")
            parent = entry["parentSource"]
            self.assertEqual(parent["declaredContentHash"], parent_hash)
            self.assertEqual(parent["ranges"], parents)
            self.assertEqual(parent["capturedChars"], utf16(original))
            self.assertEqual(parent["rangeCoordinateSystem"], "research_source_text_utf16")
            self.assertEqual(parent["offsetUnit"], "utf16_code_units")
            self.assertFalse(parent["hashVerified"])
            self.assertFalse(parent["originalTextAvailable"])
            self.assertEqual(parent["rangeMapping"], "not_verified")
        self.assertNotEqual(parents[0]["start"], original.index(first))
        self.assertEqual(row["role"], "constraint")  # Parent binding is declared, not rehashed from the snippet.
        for span in row["ranges"]:
            self.assertEqual(span["sha256"], hashlib.sha256(snippet[span["start"]:span["end"]].encode()).hexdigest())
        self.assertEqual(packed["content"], "\n[…省略原文…]\n".join(snippet[span["start"]:span["end"]] for span in packed["ranges"]))
        self.assertNotIn("未提供的中间原文", selected["context"])

    def test_legacy_snippet_without_parent_metadata_stays_explicitly_unmapped(self):
        page = source("legacy", "轻食机🙂水箱拆洗条件。", textScope="supplied_snippets")
        row = self.selector.select([page])["manifest"]["sources"][0]
        self.assertIsNone(row["contentHash"])
        self.assertIsNone(row["originalChars"])
        self.assertIsNone(row["parentSource"]["declaredContentHash"])
        self.assertIsNone(row["parentSource"]["ranges"])
        self.assertIsNone(row["parentSource"]["capturedChars"])
        self.assertFalse(row["parentSource"]["originalTextAvailable"])
        self.assertTrue(row["ranges"])

    def test_full_retained_text_keeps_legacy_hash_and_codepoint_ranges(self):
        raw = "🙂前言\n轻食机🙂水箱拆卸及清洗条件。"
        selected = self.selector.select([source("full", raw, "constraint")])
        for row in (selected["manifest"]["sources"][0], selected["sources"][0]):
            self.assertEqual(row["textScope"], "retained_text")
            self.assertEqual(row["contentHash"], hashlib.sha256(raw.encode()).hexdigest())
            self.assertEqual(row["originalChars"], len(raw))
            self.assertEqual(row["rangeCoordinateSystem"], "retained_text_unicode_codepoints")
            self.assertNotIn("parentSource", row)
            self.assertNotIn("snippetHash", row)
        span = selected["manifest"]["sources"][0]["ranges"][0]
        self.assertEqual(span["start"], raw.index("轻食机"))
        self.assertNotEqual(span["start"], len(raw[:span["start"]].encode("utf-16-le")) // 2)

    def test_table_larger_than_chunk_size_keeps_header_units_and_every_row_together(self):
        table = (
            "| 轻食机步骤 | 累计耗时（分钟） | 限制条件 |\n| --- | ---: | --- |\n"
            + "\n".join(f"| 水箱清洗步骤 {i:02d} | {1000 + i} | 合成数据不得推定办公室适用，需实测使用条件 |" for i in range(30))
            + "\n| 披露 | 不适用 | 本文商品由测试平台提供，并邀请用户撰写评测报告 |"
        )
        self.assertGreater(len(table), 1100)
        self.assertLess(len(table), 3300)
        prefix = "# 使用条件\n\n"
        body = prefix + table + "\n\n轻食机水箱清洗需核对上表单位。"
        selected = self.selector.select([source("whole-table", body, "constraint")])
        self.assertIn(table, selected["sources"][0]["content"])
        row = selected["manifest"]["sources"][0]
        exact = [span for span in row["ranges"] if span["start"] == len(prefix) and span["end"] == len(prefix) + len(table)]
        self.assertEqual(len(exact), 1)
        self.assertEqual(exact[0]["sha256"], hashlib.sha256(table.encode()).hexdigest())
        self.assertNotIn("tableOmissions", row)

    def test_table_over_source_budget_is_omitted_whole_with_auditable_reason(self):
        table = (
            "| 轻食机步骤 | 耗时（分钟） | 条件 |\n| --- | ---: | --- |\n"
            + "\n".join(f"| 水箱清洗 {i:03d} | TABLE-NUMBER-{9000 + i} | 合成数据，应保留表头和单位 |" for i in range(100))
        )
        self.assertGreater(len(table), 3300)
        paragraph = "轻食机水箱清洗需先拆除密封圈。KEEP-NON-TABLE-PARAGRAPH。"
        body = paragraph + "\n\n" + table
        selected = self.selector.select([source("oversized-table", body, "constraint")])
        self.assertIn("KEEP-NON-TABLE-PARAGRAPH", selected["context"])
        self.assertNotIn("TABLE-NUMBER", selected["context"])
        row = selected["manifest"]["sources"][0]
        self.assertEqual(row["tableOmissions"], [{
            "start": len(paragraph) + 2, "end": len(body),
            "sha256": hashlib.sha256(table.encode()).hexdigest(),
            "reason": "table_exceeds_source_budget",
        }])
        self.assertEqual(row["includedChars"], len(paragraph))
        self.assertEqual(row["omittedReason"], None)  # This source still contributes its paragraph.
        # A scan boundary must not make the tail of an incomplete table appear
        # to be a small complete table that fits the ordinary source budget.
        padding = " \n" * 119900
        scanned = self.selector.select([source("scan-boundary", padding + table, "constraint")])
        self.assertEqual(scanned["sources"], [])
        self.assertEqual(scanned["manifest"]["sources"][0]["tableOmissions"][0]["reason"], "table_scan_truncated")


class ActualSdkAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_child_role_references_and_context_method_share_the_fixed_task(self):
        from gpt_researcher.skills.context_manager import ContextManager
        import gpt_researcher.actions.agent_creator as creator
        import gpt_researcher.agent as agent_module
        import gpt_researcher.skills.researcher as conductor_module
        from types import SimpleNamespace
        self.assertEqual(importlib.metadata.version("gpt-researcher"), "0.16.1")
        old_choose = creator.choose_agent
        old_context = ContextManager.get_similar_content_by_query
        spec = make_task_spec(task())
        manifests = []
        selector, restore = install_design_pipeline(spec, manifests.append)
        try:
            with patch.object(socket.socket, "connect", side_effect=AssertionError("External sockets forbidden")):
                for module in (creator, agent_module, conductor_module):
                    label, role = await module.choose_agent(query="Deliberately drifted child query", cfg=None)
                    self.assertEqual(label, DESIGN_AGENT)
                    self.assertEqual(role, research_role(spec))
                manager = ContextManager(SimpleNamespace(memory=property(lambda _: self.fail("No embeddings may run"))))
                text = await manager.get_similar_content_by_query("办公室加水", [source("manual", "轻食机水箱清洗条件说明。", "constraint")])
                self.assertTrue(text)
                self.assertEqual(manifests[0]["filter"], CONTEXT_FILTER)
                self.assertEqual(manifests[0]["taskSpecHash"], digest(spec))
        finally:
            restore()
        self.assertIs(creator.choose_agent, old_choose)
        self.assertIs(ContextManager.get_similar_content_by_query, old_context)


class EngineHttpFixture:
    """Only HTTP is synthetic; engine, GPTR, LangChain and OpenAI SDK stay real."""
    def __init__(self, *, deep=False, fail_purpose=None, partial_writer=False, prose_plan=False, adjacent_query_arrays=False):
        self.deep = deep
        self.fail_purpose = fail_purpose
        self.partial_writer = partial_writer
        self.prose_plan = prose_plan
        self.adjacent_query_arrays = adjacent_query_arrays
        self.requests = []
        self.deep_query_calls = 0

    def route(self, request):
        import httpx
        payload = json.loads(request.content) if request.content else {}
        purpose = request.headers.get("X-Chugao-Call-Purpose")
        self.requests.append({"path": request.url.path, "purpose": purpose, "body": payload,
                              "taskSpecHash": request.headers.get("X-Chugao-Task-Spec-Hash"),
                              "contextHash": request.headers.get("X-Chugao-Context-Hash")})
        if request.url.host != "gateway.invalid":
            raise AssertionError("Only the configured synthetic gateway is allowed")
        if request.url.path.endswith("/search"):
            return httpx.Response(200, json={"results": [
                {"url": "https://sources.invalid/manual", "title": "MR9086 原文", "content": "轻食机水箱清洗说明"},
                {"url": "https://sources.invalid/truck", "title": "餐车网站", "content": "网站布局案例"},
            ]})
        if request.url.path.endswith("/crawl"):
            if payload["url"].endswith("manual"):
                return httpx.Response(200, json={"url": payload["url"], "evidenceId": "manual", "title": "MR9086 使用说明", "markdown": "轻食机 MR9086 的水箱需要拆卸后冲洗。SOURCE-RAW-K77 是合成来源原文，办公室实测数据未知。", "quality": {"decision": "keep", "routing": {"method": "heuristic", "role": "product_identity", "decisionIds": [], "reason": "Identified synthetic model"}}})
            return httpx.Response(200, json={"url": payload["url"], "evidenceId": "truck", "title": "餐车网站", "markdown": "TRUCK-DESIGN-BAD-449: 餐车网页导航与响应式布局，并非轻食机实物。", "quality": {"decision": "reject", "routing": {"method": "heuristic", "role": "irrelevant", "decisionIds": [], "reason": "Wrong object"}}})
        if request.url.path.endswith("/v1/chat/completions"):
            if purpose == self.fail_purpose:
                return httpx.Response(503, json={"error": {"type": "server_error", "message": "Synthetic non-retryable test failure"}})
            if purpose == "research.search_plan":
                response = "# 格式错误的整篇研究报告，不能修复成默认查询。" if self.prose_plan else '["轻食机 水箱 清洗步骤"]'
                if self.adjacent_query_arrays:
                    response = '["轻食机 水箱 清洗步骤"]\n["轻食机 办公室 加水流程"]'
            elif purpose == "research.deep.generate_research_plan":
                response = '{"questions":["水箱清洗如何验证？"]}'
            elif purpose == "research.deep.generate_search_queries":
                self.deep_query_calls += 1
                response = '[{"query":"轻食机 水箱 清洗步骤","researchGoal":"识别清洗负担"}]' if self.deep_query_calls == 1 else '[]'
            elif purpose == "research.deep.process_research_results":
                response = '{"learnings":[{"insight":"DRIFTED-INTERMEDIATE-TRUCK 不得替换原材料", "sourceUrl":"https://sources.invalid/manual"}],"followUpQuestions":[]}'
            elif purpose == "research.write_report":
                pieces = ["# 办公轻食机研究\n", "合成报告正文。保留 REQ-X17，办公室适用性尚未验证。"]
                partial = self.partial_writer
                class Body(httpx.AsyncByteStream):
                    async def __aiter__(self):
                        for index, text in enumerate(pieces):
                            yield sse_frame(text)
                            if partial and index == 0:
                                raise httpx.ReadError("Synthetic writer stream interrupted")
                        yield sse_frame(None, finish=True)
                        yield b"data: [DONE]\n\n"
                return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, stream=Body())
            else:
                raise AssertionError("Unexpected model purpose: " + str(purpose))
            return httpx.Response(200, json={
                "id": "synthetic-gptr", "object": "chat.completion", "created": 1, "model": "gpt-6.1-sol",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": response}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 8, "completion_tokens": 5, "total_tokens": 13},
            })
        raise AssertionError("Unexpected HTTP request: " + str(request.url))


def sse_frame(text, finish=False):
    return ("data: " + json.dumps({
        "id": "synthetic-gptr-stream", "object": "chat.completion.chunk", "created": 1, "model": "gpt-6.1-sol",
        "choices": [{"index": 0, "delta": {} if text is None else {"content": text}, "finish_reason": "stop" if finish else None}],
    }, ensure_ascii=False) + "\n\n").encode()


def offline_engine(fixture, *, evidence=None):
    import httpx
    from gpt_researcher.skills.browser import BrowserManager
    import gpt_researcher.retrievers as registry
    import gpt_researcher.utils.llm as llm
    original_helper = llm.create_chat_completion
    original_browser = BrowserManager.browse_urls
    original_retriever = registry.CustomRetriever
    references = [(module, attr) for name, module in list(sys.modules.items()) if name.startswith("gpt_researcher") and module is not None
                  for attr, value in list(vars(module).items()) if value is original_helper]
    output, diagnostics = io.StringIO(), io.StringIO()
    error = None
    async def async_handler(_, request):
        return fixture.route(request)
    def sync_handler(_, request):
        return fixture.route(request)
    with tempfile.TemporaryDirectory(prefix="gptr-v3-offline-") as temporary:
        folder = Path(temporary)
        body = task(
            runId="synthetic-run", gatewayUrl="https://gateway.invalid/api/research/internal", gatewayToken="local-no-model-key", model="gpt-6.1-sol",
            scope="deep" if fixture.deep else "standard", links=[] if fixture.deep else ["https://sources.invalid/manual"],
            maxCalls=12, maxPages=8,
            searchPlan=[{"id": "cleaning", "question": "水箱拆卸和清洗步骤是否影响使用？", "query": "轻食机 水箱 清洗", "purpose": "cleaning"}],
            context=["OLD-CONSTRUCTOR-CONTEXT 不得作为系统约束或研究原文偷偷传入"],
            evidence=[{"id": "provided", "url": "urn:chugao:provided", "title": "用户提供文本", "status": "provided", "contentKind": "user_provided_text", "content": "USER-TEXT-K43 用户提供的草案记录；不是独立办公室实测。"}],
        )
        if evidence is not None:
            body["evidence"] = evidence
        (folder / "input.json").write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
        try:
            with ExitStack() as stack:
                stack.enter_context(patch.dict(os.environ, {"RESEARCH_ENGINE": "gpt-researcher", "RESEARCH_CHECK_ONLY": "0", "OPENAI_API_KEY": "local-no-model-key", "LANGSMITH_TRACING": "false", "LANGCHAIN_TRACING_V2": "false", "OTEL_SDK_DISABLED": "true", "TYPESAFE_API_KEY": "must-not-select-jev"}))
                stack.enter_context(patch.object(socket.socket, "connect", side_effect=AssertionError("External sockets forbidden")))
                stack.enter_context(patch.object(httpx.AsyncHTTPTransport, "handle_async_request", new=async_handler))
                stack.enter_context(patch.object(httpx.HTTPTransport, "handle_request", new=sync_handler))
                stack.enter_context(patch.object(sys, "argv", [str(RUNTIME / "engine.py"), str(folder)]))
                stack.enter_context(redirect_stdout(output))
                stack.enter_context(redirect_stderr(diagnostics))
                try:
                    runpy.run_path(str(RUNTIME / "engine.py"), run_name="__main__")
                except Exception as exception:
                    error = exception
            writer_path = folder / "gptr-writer-input.json"
            writer_input = json.loads(writer_path.read_text(encoding="utf-8")) if writer_path.exists() else None
            events = [json.loads(line) for line in output.getvalue().splitlines()]
            return {"error": error, "events": events, "writerInput": writer_input, "diagnostics": diagnostics.getvalue(), "requests": fixture.requests, "taskSpec": make_task_spec(body)}
        finally:
            for module, attr in references:
                setattr(module, attr, original_helper)
            BrowserManager.browse_urls = original_browser
            registry.CustomRetriever = original_retriever


class RealEngineReplayTests(unittest.TestCase):
    def test_real_engine_reuses_snippets_with_parent_metadata_without_recrawl_or_extra_model_calls(self):
        snippet = "\n[…省略原文…]\n轻食机🙂水箱需要拆卸冲洗。REUSED-SNIPPET。"
        parents = [{"start": 1201, "end": 1240}]
        evidence = [{"id": "saved-manual", "url": "https://sources.invalid/manual", "title": "保存的说明书",
                     "status": "captured", "contentKind": "captured_text", "content": snippet,
                     "contentHash": "b" * 64, "contentRanges": parents, "capturedChars": 2000,
                     "truncated": True, "contextInclusion": "excerpt"}]
        replay = offline_engine(EngineHttpFixture(), evidence=evidence)
        self.assertIsNone(replay["error"], replay["diagnostics"])
        self.assertFalse(any(row["path"].endswith("/crawl") and row["body"].get("url") == evidence[0]["url"] for row in replay["requests"]))
        calls = [row for row in replay["requests"] if row["path"].endswith("/chat/completions")]
        self.assertEqual([row["purpose"] for row in calls], ["research.search_plan", "research.write_report"])
        result = next(event["data"] for event in replay["events"] if event["type"] == "result")
        saved = next(row for row in result["sources"] if row["evidenceId"] == "saved-manual")
        for key in ("contentHash", "contentRanges", "capturedChars", "truncated", "contextInclusion"):
            self.assertEqual(saved[key], evidence[0][key])
        row = next(row for row in result["writerContextManifest"]["sources"] if row["id"] == "saved-manual")
        self.assertIsNone(row["contentHash"])
        self.assertEqual(row["snippetHash"], hashlib.sha256(snippet.encode()).hexdigest())
        self.assertEqual(row["rangeCoordinateSystem"], "supplied_snippets_unicode_codepoints")
        self.assertEqual(row["parentSource"]["ranges"], parents)
        self.assertEqual(row["parentSource"]["declaredContentHash"], "b" * 64)
        self.assertFalse(row["parentSource"]["hashVerified"])
        packed = next(row for row in json.loads(replay["writerInput"]["context"])["sources"] if row["id"] == "saved-manual")
        self.assertEqual(packed["parentSource"], row["parentSource"])
        self.assertIn("REUSED-SNIPPET", packed["content"])

    def test_internal_prose_response_is_rejected_without_json_repair_default_or_another_model_call(self):
        replay = offline_engine(EngineHttpFixture(prose_plan=True))
        self.assertIsNotNone(replay["error"])
        self.assertEqual(sum(row["purpose"] == "research.search_plan" for row in replay["requests"]), 1)
        self.assertFalse(any(row["purpose"] == "research.write_report" for row in replay["requests"]))
        self.assertFalse(any(event["type"] in ("text", "result") for event in replay["events"]))
        self.assertEqual(validate_stage_response('```json\n{"queries":["加水条件"]}\n```', {"purpose": "research.search_plan"}), '{"queries":["加水条件"]}')

    def test_adjacent_search_arrays_preserve_every_query_without_another_model_call(self):
        metadata = {"purpose": "research.search_plan"}
        text = '["US countertop appliance market 2019-2025"]\n["US all in one meal preparation consumer research"]'
        self.assertEqual(json.loads(validate_stage_response(text, metadata)), [
            "US countertop appliance market 2019-2025",
            "US all in one meal preparation consumer research",
        ])
        replay = offline_engine(EngineHttpFixture(adjacent_query_arrays=True))
        self.assertIsNone(replay["error"], replay["diagnostics"])
        self.assertEqual(sum(row["purpose"] == "research.search_plan" for row in replay["requests"]), 1)
        queries = [row["body"]["query"] for row in replay["requests"] if row["path"].endswith("/search")]
        self.assertIn("轻食机 水箱 清洗步骤", queries)
        self.assertIn("轻食机 办公室 加水流程", queries)
        self.assertTrue(any(event["type"] == "result" for event in replay["events"]))

    def test_search_array_normalization_never_ignores_prose_wrong_shapes_or_truncation(self):
        for value in (
            '["query"]\nSome explanation',
            '["query"]\n{"queries":["another query"]}',
            '["query"]\n["truncated"',
            '["query"]\n[17]',
        ):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "Research JSON contract failed"):
                validate_stage_response(value, {"purpose": "research.search_plan"})
        with self.assertRaisesRegex(ValueError, "Research JSON contract failed"):
            validate_stage_response('[{"query":"one","researchGoal":"goal"}]\n[]', {"purpose": "research.deep.generate_search_queries"})

    def test_real_engine_first_model_call_is_json_planning_and_writer_contains_fixed_task_and_actual_ranges(self):
        replay = offline_engine(EngineHttpFixture())
        self.assertIsNone(replay["error"], replay["diagnostics"])
        calls = [row for row in replay["requests"] if row["path"].endswith("/chat/completions")]
        self.assertEqual([row["purpose"] for row in calls], ["research.search_plan", "research.write_report"])
        self.assertIn("REQ-X17", canonical_json(calls[0]["body"]["messages"]))
        self.assertNotIn("只输出有来源的 Markdown 研究稿", canonical_json(calls[0]["body"]["messages"]))
        writer = replay["writerInput"]
        user_message = calls[-1]["body"]["messages"][-1]["content"]
        self.assertEqual(user_message, writer["customPrompt"] + "\n\nContext: " + writer["context"])
        for sentinel in ("REQ-X17", "USER-TEXT-K43", "SOURCE-RAW-K77"):
            self.assertIn(sentinel, user_message)
        for excluded in ("TRUCK-DESIGN-BAD-449", "OLD-CONSTRUCTOR-CONTEXT"):
            self.assertNotIn(excluded, user_message)
        self.assertEqual(calls[-1]["contextHash"], writer["manifest"]["contextHash"])
        self.assertEqual(calls[-1]["taskSpecHash"], digest(replay["taskSpec"]))
        results = [event["data"] for event in replay["events"] if event["type"] == "result"]
        self.assertEqual(results[0]["writerContextManifest"], writer["manifest"])
        self.assertEqual(results[0]["runtimeContract"], CONTRACT_VERSION)
        text = "".join(event["data"]["delta"] for event in replay["events"] if event["type"] == "text")
        self.assertEqual(text, results[0]["text"])
        self.assertNotIn("[\"轻食机", text)
        self.assertFalse(any("embedding" in row["path"] for row in replay["requests"]))
        save = os.environ.get("CHUGAO_TEST_ARTIFACT_DIR")
        if save:
            target = Path(save)
            target.mkdir(parents=True, exist_ok=True)
            (target / "gptr-v3-offline-replay.json").write_text(json.dumps({
                "notice": "Real pinned SDK/engine, synthetic HTTP and synthetic model text. No live research quality claim.",
                "gptrVersion": importlib.metadata.version("gpt-researcher"), "requests": replay["requests"],
                "writerInput": writer, "events": replay["events"],
            }, ensure_ascii=False, indent=2), encoding="utf-8")

    def test_real_deep_children_skip_role_generation_and_drifted_learnings_never_replace_raw_writer_material(self):
        replay = offline_engine(EngineHttpFixture(deep=True))
        self.assertIsNone(replay["error"], replay["diagnostics"])
        calls = [row for row in replay["requests"] if row["purpose"]]
        purposes = [row["purpose"] for row in calls]
        self.assertIn("research.deep.process_research_results", purposes)
        self.assertNotIn("research.role", purposes)
        for row in calls:
            self.assertIn("REQ-X17", canonical_json(row["body"]["messages"]))
        writer_message = calls[-1]["body"]["messages"][-1]["content"]
        self.assertIn("SOURCE-RAW-K77", writer_message)
        self.assertNotIn("DRIFTED-INTERMEDIATE-TRUCK", writer_message)
        self.assertNotIn("TRUCK-DESIGN-BAD-449", writer_message)

    def test_real_deep_swallowed_model_failure_is_failure_and_never_becomes_an_insufficient_success(self):
        replay = offline_engine(EngineHttpFixture(deep=True, fail_purpose="research.deep.process_research_results"))
        self.assertIsNotNone(replay["error"])
        self.assertIn("Research model failed inside the framework", str(replay["error"]))
        self.assertEqual(sum(row["purpose"] == "research.deep.process_research_results" for row in replay["requests"]), 1)
        self.assertFalse(any(row["purpose"] == "research.write_report" for row in replay["requests"]))
        self.assertFalse(any(event["type"] == "result" for event in replay["events"]))

    def test_real_writer_disconnect_keeps_public_fragment_and_saved_writer_contract_without_http_replay(self):
        replay = offline_engine(EngineHttpFixture(partial_writer=True))
        self.assertIsNotNone(replay["error"])
        self.assertEqual(sum(row["purpose"] == "research.write_report" for row in replay["requests"]), 1)
        self.assertTrue(replay["writerInput"]["manifest"]["sources"])
        fragments = [event for event in replay["events"] if event["type"] == "text"]
        self.assertEqual([event["data"]["delta"] for event in fragments], ["# 办公轻食机研究\n"])
        self.assertFalse(any(event["type"] == "result" for event in replay["events"]))


if __name__ == "__main__":
    unittest.main()
