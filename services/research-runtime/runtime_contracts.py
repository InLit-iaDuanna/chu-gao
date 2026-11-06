"""Small, testable boundaries around the pinned open-source research frameworks.

No model request is made when this module is imported. These helpers do not
implement GPT Researcher or DeerFlow; their planning/execution stays upstream.
"""
from __future__ import annotations

import hashlib
import inspect
import json
import os
from pathlib import Path
import re
import sys


class CompletedModelCache:
    """Replay only validated, byte-matched completed steps on an explicit retry."""

    def __init__(self, folder: Path, namespace: dict, previous_runs=()):
        self.folder = folder.resolve()
        self.path = self.folder / "completed-model-steps.jsonl"
        self.namespace = self._hash({"version": 1, **namespace})
        self.values = {}
        self.persisted = set()
        for run_id in list(previous_runs)[:20]:
            if not isinstance(run_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", run_id):
                continue
            parent = self.folder.parent / run_id
            if parent.is_symlink():
                continue
            self._load(parent / self.path.name)
        self._load(self.path, own=True)

    @staticmethod
    def _hash(value):
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()

    def _load(self, path, own=False):
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 8 * 1024 * 1024:
            return
        with path.open(encoding="utf-8") as records:
            for line in records:
                if len(line) > 2 * 1024 * 1024:
                    continue
                try:
                    row = json.loads(line)
                    key, text = row.get("key"), row.get("text")
                    if (row.get("namespace") != self.namespace or not isinstance(key, str)
                            or not re.fullmatch(r"[a-f0-9]{64}", key) or not isinstance(text, str)
                            or not text.strip() or row.get("textHash") != self._hash(text)):
                        continue
                    if own:
                        self.values[key] = text
                        self.persisted.add(key)
                    else:
                        self.values.setdefault(key, text)
                except (ValueError, TypeError, AttributeError):
                    continue

    def key(self, messages, metadata, options):
        parameters = {key: value for key, value in options.items()
                      if key not in {"api_key", "openai_api_key", "openai_api_base", "base_url", "default_headers", "max_retries", "http_async_client", "http_client"}}
        return self._hash({"namespace": self.namespace, "purpose": metadata.get("purpose"), "messages": messages, "parameters": parameters})

    def get(self, key):
        return self.values.get(key)

    def put(self, key, text):
        if key in self.persisted:
            return
        row = {"namespace": self.namespace, "key": key, "text": text, "textHash": self._hash(text)}
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as target:
            target.write(json.dumps(row, ensure_ascii=False) + "\n")
            target.flush()
            os.fsync(target.fileno())
        self.values[key] = text
        self.persisted.add(key)


def install_gptr_single_attempt(on_call=None, *, metadata_provider=None, prepare_messages=None, finish_response=None, on_failure=None, response_cache=None) -> int:
    """Remove GPTR's outer 10-attempt helper loop; the gateway owns retry policy.

    Patch the existing imported helper references in this isolated process only.
    The actual GenericLLMProvider and its real streaming implementation remain.
    A transport failure latches this worker so swallowed framework exceptions
    cannot trigger further paid model calls behind the gateway's retry boundary.
    Optional task-local metadata records the real call site. Trace headers never
    change the gateway's authorization, configured model, effort, or budget.
    """
    import gpt_researcher.utils.llm as llm
    original = llm.create_chat_completion
    signature = inspect.signature(original)
    required = {"messages", "model", "llm_provider", "stream", "websocket", "llm_kwargs"}
    if not required.issubset(signature.parameters):
        raise RuntimeError("Pinned GPT Researcher helper signature changed")
    failure = None
    sequence = 0

    async def once(*args, **kwargs):
        nonlocal failure, sequence
        if failure is not None:
            raise RuntimeError("An earlier model call failed; no outer framework replay") from failure
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        values = bound.arguments
        if values["llm_provider"] != "openai":
            raise RuntimeError("This gateway adapter permits only its configured OpenAI-compatible provider")
        options = {"model": values["model"], "max_tokens": values.get("max_tokens"), "temperature": values.get("temperature")}
        overrides = values.get("llm_kwargs")
        if overrides is None and os.environ.get("LLM_KWARGS"):
            overrides = json.loads(os.environ["LLM_KWARGS"])
        options.update(overrides or {})
        options.update(max_retries=0, openai_api_base=os.environ["OPENAI_BASE_URL"])
        try:
            messages = prepare_messages(values["messages"]) if prepare_messages else values["messages"]
            metadata = {}
            if on_call or metadata_provider:
                frame = inspect.currentframe().f_back
                try:
                    module_name = frame.f_globals.get("__name__", "")
                    function_name = frame.f_code.co_name
                finally:
                    del frame
                trace = metadata_provider(module_name, function_name) if metadata_provider else {}
                trace = trace or {}
                sequence += 1
                messages_json = json.dumps(messages, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                metadata = {
                    **trace, "sequence": sequence,
                    "caller": module_name + "." + function_name,
                    "stream": bool(values["stream"]), "model": values["model"],
                    "requestMessageChars": len(messages_json),
                    "requestMessageHash": hashlib.sha256(messages_json.encode("utf-8")).hexdigest(),
                }
                headers = dict(options.get("default_headers") or {})
                for key, name in (("purpose", "X-Chugao-Call-Purpose"), ("taskSpecHash", "X-Chugao-Task-Spec-Hash"), ("contextHash", "X-Chugao-Context-Hash")):
                    value = trace.get(key)
                    if isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_.-]{1,128}", value):
                        headers[name] = value
                options["default_headers"] = headers
            cache_key = response_cache.key(messages, metadata, {**options, "stream": bool(values["stream"]), "kwargs": values.get("kwargs", {})}) if response_cache else None
            text = response_cache.get(cache_key) if response_cache else None
            metadata["cacheHit"] = text is not None
            if on_call:
                on_call(metadata)
            if text is None:
                provider = llm.get_llm("openai", **options)
                text = await provider.get_chat_response(messages, values["stream"], values["websocket"], **values.get("kwargs", {}))
            if not isinstance(text, str) or not text.strip():
                raise RuntimeError("Model returned no report text")
            if finish_response:
                text = finish_response(text, metadata)
            if response_cache:
                response_cache.put(cache_key, text)
            # The authoritative usage/cost ledger is the Chugao gateway; GPTR's
            # generic model-name price table is not this compatibility provider.
            return text
        except Exception as error:
            failure = error
            if on_failure:
                on_failure(error)
            raise

    count = 0
    for name, module in list(sys.modules.items()):
        if name.startswith("gpt_researcher") and module is not None:
            for attr, value in list(vars(module).items()):
                if value is original:
                    setattr(module, attr, once)
                    count += 1
    if count < 3:
        raise RuntimeError("Pinned GPT Researcher imported-helper contract changed")
    return count


def public_proposal_event(event: dict) -> tuple[str, dict] | None:
    """Production has tool activity, not a public assistant text stream.

    Auxiliary summary/memory model chunks are private workflow output. There is
    no reliable public-purpose marker in this embedded integration, so all raw
    model chunks stay off the user stream. File status comes from the real tool.
    """
    name = event.get("name", "")
    if event.get("event") == "on_tool_start":
        return "activity", {"message": "正在生成可编辑提案" if name == "chugao_create_proposal" else "正在读取已锁定的研究资料", "tool": name}
    if event.get("event") == "on_tool_end":
        result = event.get("data", {}).get("output")
        if getattr(result, "status", None) == "error":
            return "activity", {"message": "提案内容未通过校验，正在修正结构或引用", "tool": name}
    return None


def raise_proposal_model_failure(event: dict) -> None:
    if event.get("event") not in ("on_chat_model_end", "on_chain_end"):
        return
    message = event.get("data", {}).get("output")
    if isinstance(message, dict):
        messages = message.get("messages", [])
        message = messages[-1] if messages else None
    metadata = getattr(message, "additional_kwargs", {})
    if metadata.get("deerflow_error_fallback"):
        raise RuntimeError("Proposal model did not complete; the frozen research package was retained")


def load_proposal_bundle(root: Path, expected_version: str) -> tuple[dict, list[Path]]:
    root = root.resolve()
    pointer = root / "proposal-manifest.json"
    if pointer.is_symlink() or not pointer.is_file() or pointer.stat().st_size > 128_000:
        raise ValueError("Missing or invalid atomic proposal manifest")
    manifest = json.loads(pointer.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 2 or manifest.get("package_version") != expected_version:
        raise ValueError("Proposal does not match its locked final research package")
    bundle = manifest.get("bundle", "")
    digest = manifest.get("export_hash", "")
    if not re.fullmatch(r"[a-f0-9]{64}", digest) or bundle != "proposal-" + digest[:20]:
        raise ValueError("Invalid proposal bundle identity")
    entries = manifest.get("files", [])
    if not isinstance(entries, list) or not 1 <= len(entries) <= 3:
        raise ValueError("Invalid artifact selection")
    paths = []
    formats = set()
    for entry in entries:
        relative = entry.get("path", "")
        if not isinstance(relative, str) or not re.fullmatch(re.escape(bundle) + r"/(proposal\.(pptx|docx)|index\.html)", relative):
            raise ValueError("Artifact path escapes the selected proposal bundle")
        path = root / relative
        if path.is_symlink() or path.parent.is_symlink() or not path.is_file() or path.resolve().parent.parent != root:
            raise ValueError("Artifact must be a regular file inside its selected bundle")
        data = path.read_bytes()
        if not 0 < len(data) <= 32 * 1024 * 1024 or len(data) != entry.get("bytes") or hashlib.sha256(data).hexdigest() != entry.get("sha256"):
            raise ValueError("Artifact bytes differ from the atomic manifest")
        fmt = entry.get("format")
        if fmt != path.suffix[1:] or fmt in formats:
            raise ValueError("Duplicate or mismatched artifact format")
        formats.add(fmt)
        paths.append(path)
    return manifest, paths
