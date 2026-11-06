"""Pinned real SDK + fake HTTP transport tests; no model/network calls.

Run with the real gpt-researcher==0.16.1 distribution on PYTHONPATH. The
GenericLLMProvider, LangChain ChatOpenAI and OpenAI HTTP client stay real; only
HTTP transport is replaced. Manifest tests validate selection/byte integrity,
not Office rendering (covered separately by test_proposal_export.py).
"""
import hashlib
import importlib.metadata
import inspect
import io
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
from contextlib import redirect_stdout
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime_contracts import CompletedModelCache, install_gptr_single_attempt, load_proposal_bundle, public_proposal_event, raise_proposal_model_failure


def completion(text):
    return {
        "id": "chatcmpl-local-contract-test", "object": "chat.completion", "created": 1,
        "model": "gpt-6.1-sol",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8},
    }


def frame(text=None, finish=False):
    value = {
        "id": "chatcmpl-local-stream-test", "object": "chat.completion.chunk", "created": 1,
        "model": "gpt-6.1-sol",
        "choices": [{"index": 0, "delta": {} if text is None else {"content": text}, "finish_reason": "stop" if finish else None}],
    }
    return ("data: " + json.dumps(value, ensure_ascii=False) + "\n\n").encode()


class RealGptrTransportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {
            "OPENAI_API_KEY": "local-test-no-model", "OPENAI_BASE_URL": "https://gateway.invalid/v1",
            "LANGSMITH_TRACING": "false", "LANGCHAIN_TRACING_V2": "false", "OTEL_SDK_DISABLED": "true",
        })
        self.env.start()
        self.network = patch.object(socket.socket, "connect", side_effect=AssertionError("External sockets forbidden in contract tests"))
        self.network.start()
        import gpt_researcher.utils.llm as llm
        import httpx
        self.httpx = httpx
        self.llm = llm
        self.original = llm.create_chat_completion
        self.references = [
            (module, attr)
            for name, module in list(sys.modules.items()) if name.startswith("gpt_researcher") and module is not None
            for attr, value in list(vars(module).items()) if value is self.original
        ]
        self.count = install_gptr_single_attempt()

    async def asyncTearDown(self):
        for module, attr in self.references:
            setattr(module, attr, self.original)
        self.network.stop()
        self.env.stop()

    async def call(self, client, **kwargs):
        return await self.llm.create_chat_completion(
            messages=[{"role": "user", "content": "Synthetic transport verification only"}],
            model="gpt-6.1-sol", llm_provider="openai",
            llm_kwargs={"http_async_client": client, "max_retries": 9},
            **kwargs,
        )

    async def test_real_pinned_helper_contract_and_references(self):
        self.assertEqual(importlib.metadata.version("gpt-researcher"), "0.16.1")
        self.assertTrue({"messages", "model", "llm_provider", "stream", "websocket", "llm_kwargs"}.issubset(inspect.signature(self.original).parameters))
        self.assertGreaterEqual(self.count, 3)
        self.assertEqual(self.count, len(self.references))
        self.assertTrue(all(getattr(module, attr) is self.llm.create_chat_completion for module, attr in self.references))

    async def test_http_503_is_sent_once_and_latches_later_framework_replay(self):
        requests = []
        def handler(request):
            requests.append(request)
            return self.httpx.Response(503, json={"error": {"message": "Synthetic upstream failure", "type": "server_error"}})
        async with self.httpx.AsyncClient(transport=self.httpx.MockTransport(handler)) as client:
            with self.assertRaises(Exception):
                await self.call(client)
            with self.assertRaisesRegex(RuntimeError, "no outer framework replay"):
                await self.call(client)
        self.assertEqual(len(requests), 1, "Neither GPTR nor the actual OpenAI SDK may retry this failure")
        self.assertEqual(str(requests[0].url), "https://gateway.invalid/v1/chat/completions")

    async def test_transport_disconnect_is_sent_once(self):
        requests = []
        def handler(request):
            requests.append(request)
            raise self.httpx.ReadError("Injected connection loss", request=request)
        async with self.httpx.AsyncClient(transport=self.httpx.MockTransport(handler)) as client:
            with self.assertRaises(Exception):
                await self.call(client)
            with self.assertRaisesRegex(RuntimeError, "no outer framework replay"):
                await self.call(client)
        self.assertEqual(len(requests), 1)

    async def test_actual_report_action_swallows_error_but_does_not_replay_http(self):
        # GPTR's real report action has a second role-flattened fallback call
        # and then swallows its error. The latch must stop the fallback HTTP;
        # engine.py must separately reject the resulting empty report.
        from gpt_researcher.actions.report_generation import generate_report
        requests = []
        def handler(request):
            requests.append(request)
            return self.httpx.Response(503, json={"error": {"message": "Synthetic failed report stream", "type": "server_error"}})
        async with self.httpx.AsyncClient(transport=self.httpx.MockTransport(handler)) as client:
            cfg = SimpleNamespace(smart_llm_model="gpt-6.1-sol", smart_llm_provider="openai", smart_token_limit=512, llm_kwargs={"http_async_client": client, "max_retries": 9})
            with redirect_stdout(io.StringIO()):
                report = await generate_report(query="Synthetic case", context="Known synthetic input", agent_role_prompt="Local contract check", report_type="research_report", tone=None, report_source="web", websocket=None, cfg=cfg, custom_prompt="Synthetic report only")
        self.assertEqual(report, "", "Actual GPTR action returns empty after swallowing its fallback failure")
        self.assertEqual(len(requests), 1, "The real GPTR fallback must not make a second upstream HTTP call")

    async def test_empty_success_response_is_not_replayed(self):
        requests = []
        def handler(request):
            requests.append(request)
            return self.httpx.Response(200, json=completion(""))
        async with self.httpx.AsyncClient(transport=self.httpx.MockTransport(handler)) as client:
            with self.assertRaisesRegex(RuntimeError, "no report text"):
                await self.call(client)
            with self.assertRaisesRegex(RuntimeError, "no outer framework replay"):
                await self.call(client)
        self.assertEqual(len(requests), 1)

    async def test_successful_steps_remain_separate_requests_without_invented_cost_callback(self):
        requests, costs = [], []
        def handler(request):
            requests.append(request)
            return self.httpx.Response(200, json=completion("Known synthetic answer"))
        async with self.httpx.AsyncClient(transport=self.httpx.MockTransport(handler)) as client:
            self.assertEqual(await self.call(client, cost_callback=costs.append), "Known synthetic answer")
            self.assertEqual(await self.call(client), "Known synthetic answer")
        self.assertEqual(len(requests), 2)
        self.assertEqual(costs, [], "Gateway usage/cost is authoritative, not GPTR's name-based price table")

    async def test_explicit_retry_reuses_only_completed_matching_model_steps(self):
        requests, events = [], []
        def handler(request):
            prompt = json.loads(request.content)["messages"][0]["content"]
            requests.append(prompt)
            if prompt == "step B" and requests.count(prompt) == 1:
                return self.httpx.Response(503, json={"error": {"type": "server_error", "message": "Synthetic failure"}})
            return self.httpx.Response(200, json=completion("Completed " + prompt))

        def install(cache):
            for module, attr in self.references:
                setattr(module, attr, self.original)
            install_gptr_single_attempt(events.append, metadata_provider=lambda *_: {"purpose": "research.search_plan"}, response_cache=cache)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first, second = root / "first", root / "second"
            first.mkdir()
            second.mkdir()
            async with self.httpx.AsyncClient(transport=self.httpx.MockTransport(handler)) as client:
                async def step(prompt):
                    return await self.llm.create_chat_completion(messages=[{"role": "user", "content": prompt}], model="gpt-6.1-sol", llm_provider="openai", llm_kwargs={"http_async_client": client})
                install(CompletedModelCache(first, {"task": "same", "effort": "xhigh"}))
                self.assertEqual(await step("step A"), "Completed step A")
                with self.assertRaises(Exception):
                    await step("step B")
                resumed = CompletedModelCache(second, {"task": "same", "effort": "xhigh"}, ["first"])
                self.assertEqual(len(resumed.values), 1)
                install(resumed)
                self.assertEqual(await step("step A"), "Completed step A")
                self.assertEqual(requests, ["step A", "step B"])
                self.assertEqual(await step("step B"), "Completed step B")
                self.assertEqual(requests, ["step A", "step B", "step B"])
                self.assertEqual([event["cacheHit"] for event in events], [False, False, True, False])
                self.assertEqual(len((second / "completed-model-steps.jsonl").read_text().splitlines()), 2)

    async def test_a_response_rejected_by_the_contract_is_never_cached(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = CompletedModelCache(Path(temporary), {"task": "same"})
            for module, attr in self.references:
                setattr(module, attr, self.original)
            def reject(*_):
                raise ValueError("Synthetic invalid contract")
            install_gptr_single_attempt(finish_response=reject, response_cache=cache)
            async with self.httpx.AsyncClient(transport=self.httpx.MockTransport(lambda _: self.httpx.Response(200, json=completion("Invalid JSON")))) as client:
                with self.assertRaisesRegex(ValueError, "invalid contract"):
                    await self.call(client)
            self.assertEqual(cache.values, {})
            self.assertFalse(cache.path.exists())

    async def test_real_stream_decoder_emits_first_paragraph_before_end(self):
        events, seen_after_first, requests = [], [], []
        class Sink:
            async def send_json(self, value):
                events.append(value)
        class Body(self.httpx.AsyncByteStream):
            async def __aiter__(self):
                yield frame("第一段真实协议增量\n")
                seen_after_first.append(len(events))
                yield frame("第二段")
                yield frame(finish=True)
                yield b"data: [DONE]\n\n"
        def handler(request):
            requests.append(request)
            return self.httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=Body())
        async with self.httpx.AsyncClient(transport=self.httpx.MockTransport(handler)) as client:
            text = await self.call(client, stream=True, websocket=Sink())
        self.assertEqual(text, "第一段真实协议增量\n第二段")
        self.assertEqual(seen_after_first, [1])
        self.assertEqual([row["output"] for row in events], ["第一段真实协议增量\n", "第二段"])
        self.assertTrue(json.loads(requests[0].content)["stream"])
        self.assertEqual(len(requests), 1)

    async def test_partial_stream_then_disconnect_preserves_emitted_chunk_without_reexecution(self):
        events, requests = [], []
        class Sink:
            async def send_json(self, value):
                events.append(value)
        httpx_module = self.httpx
        # The nested iterator has its own self; keep the real exception type explicit.
        class FailingBody(httpx_module.AsyncByteStream):
            async def __aiter__(self):
                yield frame("已收到的片段\n")
                raise httpx_module.ReadError("Injected partial-stream disconnect")
        def handler(request):
            requests.append(request)
            return self.httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=FailingBody())
        async with self.httpx.AsyncClient(transport=self.httpx.MockTransport(handler)) as client:
            with self.assertRaises(Exception):
                await self.call(client, stream=True, websocket=Sink())
            with self.assertRaisesRegex(RuntimeError, "no outer framework replay"):
                await self.call(client, stream=True, websocket=Sink())
        self.assertEqual(len(requests), 1)
        self.assertEqual([row["output"] for row in events], ["已收到的片段\n"])


class CompletedModelCacheTests(unittest.TestCase):
    def test_namespace_prompt_parameters_and_integrity_are_part_of_reuse(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first, second = root / "first", root / "second"
            first.mkdir()
            second.mkdir()
            cache = CompletedModelCache(first, {"taskSpecHash": "task", "effort": "xhigh"})
            messages, metadata, options = [{"role": "user", "content": "Original"}], {"purpose": "research.search_plan"}, {"model": "sol", "max_tokens": 1000}
            key = cache.key(messages, metadata, options)
            cache.put(key, '["completed"]')
            same = CompletedModelCache(second, {"taskSpecHash": "task", "effort": "xhigh"}, ["first"])
            self.assertEqual(same.get(key), '["completed"]')
            self.assertIsNone(same.get(same.key([{ "role": "user", "content": "Changed" }], metadata, options)))
            self.assertIsNone(same.get(same.key(messages, metadata, {**options, "max_tokens": 2000})))
            other = CompletedModelCache(second, {"taskSpecHash": "task", "effort": "medium"}, ["first"])
            self.assertEqual(other.values, {})
            row = json.loads(cache.path.read_text())
            row["text"] = "Tampered"
            cache.path.write_text(json.dumps(row))
            self.assertEqual(CompletedModelCache(second, {"taskSpecHash": "task", "effort": "xhigh"}, ["first"]).values, {})


class PublicProposalEventsTests(unittest.TestCase):
    def test_model_fallback_preserves_the_upstream_failure_instead_of_a_missing_manifest_error(self):
        event = {"event": "on_chat_model_end", "data": {"output": SimpleNamespace(additional_kwargs={"deerflow_error_fallback": True})}}
        with self.assertRaisesRegex(RuntimeError, "Proposal model did not complete"):
            raise_proposal_model_failure(event)
        with self.assertRaisesRegex(RuntimeError, "Proposal model did not complete"):
            raise_proposal_model_failure({"event": "on_chain_end", "data": {"output": {"messages": [event["data"]["output"]]}}})
        raise_proposal_model_failure({"event": "on_chat_model_end", "data": {"output": SimpleNamespace(additional_kwargs={})}})
        raise_proposal_model_failure({"event": "on_chain_end", "data": {"output": {"messages": []}}})

    def test_auxiliary_model_chunks_and_final_claims_are_not_public_text(self):
        for kind in ("on_chat_model_stream", "on_chat_model_end", "on_chain_stream", "on_chain_end"):
            self.assertIsNone(public_proposal_event({"event": kind, "name": "summarization", "data": {"chunk": "SESSION INTENT: No files have been generated yet", "output": "Done"}}))

    def test_tool_activity_is_public_without_forwarding_input_or_output_bodies(self):
        kind, value = public_proposal_event({"event": "on_tool_start", "name": "chugao_create_proposal", "data": {"input": "private details"}})
        self.assertEqual(kind, "activity")
        self.assertEqual(value["tool"], "chugao_create_proposal")
        self.assertNotIn("private", json.dumps(value))
        kind, value = public_proposal_event({"event": "on_tool_start", "name": "read_file"})
        self.assertEqual(kind, "activity")
        self.assertIn("读取", value["message"])

    def test_tool_validation_error_is_activity_and_success_waits_for_manifest(self):
        value = public_proposal_event({"event": "on_tool_end", "name": "chugao_create_proposal", "data": {"output": SimpleNamespace(status="error", content="private trace")}})
        self.assertEqual(value[0], "activity")
        self.assertIn("未通过", value[1]["message"])
        self.assertIsNone(public_proposal_event({"event": "on_tool_end", "name": "chugao_create_proposal", "data": {"output": SimpleNamespace(status="success")}}))


class ProposalBundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="proposal-contract-")
        self.root = Path(self.temporary.name)
        self.digest = hashlib.sha256(b"synthetic locked export").hexdigest()
        self.bundle = "proposal-" + self.digest[:20]
        folder = self.root / self.bundle
        folder.mkdir()
        self.manifest = {"schema_version": 2, "package_version": "locked-version", "export_hash": self.digest, "bundle": self.bundle, "status": "draft", "files": []}
        for name in ("proposal.pptx", "proposal.docx", "index.html"):
            content = ("Synthetic byte-integrity fixture " + name).encode()
            (folder / name).write_bytes(content)
            self.manifest["files"].append({"path": f"{self.bundle}/{name}", "format": name.split(".")[-1], "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
        self.write_manifest()

    def tearDown(self):
        self.temporary.cleanup()

    def write_manifest(self):
        (self.root / "proposal-manifest.json").write_text(json.dumps(self.manifest))

    def test_selects_only_atomic_bundle_not_stale_neighbor_files(self):
        (self.root / "old-proposal.pptx").write_bytes(b"stale")
        manifest, paths = load_proposal_bundle(self.root, "locked-version")
        self.assertEqual(manifest["package_version"], "locked-version")
        self.assertEqual(len(paths), 3)
        self.assertTrue(all(path.parent.name == self.bundle for path in paths))

    def test_version_and_bundle_identity_are_checked(self):
        with self.assertRaisesRegex(ValueError, "locked final research package"):
            load_proposal_bundle(self.root, "another-version")
        self.manifest["bundle"] = "proposal-other"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "bundle identity"):
            load_proposal_bundle(self.root, "locked-version")

    def test_tampered_artifact_bytes_are_rejected(self):
        (self.root / self.manifest["files"][0]["path"]).write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "bytes differ"):
            load_proposal_bundle(self.root, "locked-version")

    def test_manifest_and_bundle_symlinks_are_rejected(self):
        pointer = self.root / "proposal-manifest.json"
        pointer.rename(self.root / "actual.json")
        pointer.symlink_to(self.root / "actual.json")
        with self.assertRaisesRegex(ValueError, "atomic proposal manifest"):
            load_proposal_bundle(self.root, "locked-version")
        pointer.unlink()
        self.write_manifest()
        (self.root / self.bundle).rename(self.root / "actual-bundle")
        (self.root / self.bundle).symlink_to(self.root / "actual-bundle", target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "regular file"):
            load_proposal_bundle(self.root, "locked-version")

    def test_path_traversal_and_duplicate_formats_are_rejected(self):
        self.manifest["files"][0]["path"] = "../proposal.pptx"
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "escapes"):
            load_proposal_bundle(self.root, "locked-version")
        self.manifest["files"] = [self.manifest["files"][1], self.manifest["files"][1]]
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            load_proposal_bundle(self.root, "locked-version")


if __name__ == "__main__":
    unittest.main()
