"""Local-only contract tests; no real authorization, generation, or paid calls."""

from __future__ import annotations

import base64
from contextlib import redirect_stderr, redirect_stdout
from email import policy
from email.parser import BytesParser
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


TEST_DIR = Path(__file__).resolve().parent
SCRIPT = TEST_DIR.parent / "scripts" / "chugao.py"
SPEC = importlib.util.spec_from_file_location("chugao_cli", SCRIPT)
chugao = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(chugao)

ACCESS_TOKEN = "local-access-token-private"
DEVICE_CODE = "local-device-code-private"
ERROR_SECRET = "upstream-secret-must-not-appear"
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII="
)


def credential(token=ACCESS_TOKEN, *, expired=False):
    return {
        "access_token": token, "token_type": "Bearer",
        "expires_at": time.time() + (-1 if expired else 3600), "scope": "images",
    }


class FakeClock:
    def __init__(self):
        self.value = 0
        self.sleeps = []

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.value += seconds


class MockApi:
    def __init__(self):
        self.events = []
        self.uploads = []
        self.jobs = {}
        self.tokens = {ACCESS_TOKEN: "account-1"}
        self.used_single_tokens = set()
        self.authorized_account = "account-1"
        self.issued_token = "fresh-local-token-private"
        self.oauth_results = []
        self.auth_expires = 600
        self.auth_interval = 5
        self.verification_override = None
        self.statuses = ["RUNNING", "SUCCEEDED"]
        self.drop_submit_responses = 0
        self.before_submit = None
        self.redirect = None
        self.errors = {}
        self.image_b64 = base64.b64encode(PNG).decode()
        self.image_mime = "image/png"
        self.models = [{
            "id": "live-image-v7", "displayName": "Live Image Seven", "available": True,
            "capabilities": {
                "sizes": ["768x768", "1024x1024"], "qualities": ["draft", "standard"],
                "backgrounds": ["opaque", "transparent"], "outputFormats": ["png", "jpeg", "webp"],
                "maxN": 1, "maxReferenceImages": 4, "supportsReferenceImage": True,
            },
            "defaults": {"size": "768x768", "quality": "standard", "outputFormat": "png", "background": "opaque"},
            "costTable": {"flat": 7}, "pricingRules": [{"credits": 7, "priority": 1}],
            "upstream": ERROR_SECRET,
        }]
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                owner.handle(self)

            def do_POST(self):
                owner.handle(self)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def send(self, handler, value, status=200, *, raw=False):
        content = json.dumps(value if raw else {"ok": True, "data": value}).encode()
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(content)))
        handler.end_headers()
        handler.wfile.write(content)

    def matching(self, method, path):
        return [event for event in self.events if event["method"] == method and event["path"] == path]

    def handle(self, handler):
        path = urlsplit(handler.path).path
        data = handler.rfile.read(int(handler.headers.get("Content-Length", "0")))
        event = {"method": handler.command, "path": path, "headers": dict(handler.headers), "body": data}
        self.events.append(event)
        if self.redirect and path == self.redirect[0]:
            handler.send_response(self.redirect[1])
            handler.send_header("Location", self.redirect[2])
            handler.send_header("Content-Length", "0")
            handler.end_headers()
            return
        if path in self.errors:
            status, value = self.errors[path]
            self.send(handler, value, status, raw=True)
            return
        if path == "/api/agent/device-authorization":
            link = self.verification_override or self.origin + "/app/agent/authorize"
            self.send(handler, {
                "device_code": DEVICE_CODE, "user_code": "ABCD-EFGH",
                "verification_uri": link, "verification_uri_complete": link + "?user_code=ABCD-EFGH",
                "expires_in": self.auth_expires, "interval": self.auth_interval,
            }, raw=True)
            return
        if path == "/api/agent/token":
            result = self.oauth_results.pop(0) if self.oauth_results else "success"
            if result != "success":
                self.send(handler, {"error": result, "error_description": ERROR_SECRET}, 400, raw=True)
            else:
                self.tokens[self.issued_token] = self.authorized_account
                self.send(handler, {
                    "access_token": self.issued_token, "token_type": "Bearer",
                    "expires_in": 3600, "scope": "images",
                }, raw=True)
            return
        token = handler.headers.get("Authorization", "").removeprefix("Bearer ")
        account_id = self.tokens.get(token)
        if account_id is None:
            self.send(handler, {"ok": False, "error": {"code": "UNAUTHORIZED", "message": ERROR_SECRET}}, 401, raw=True)
            return
        if token in self.used_single_tokens and (
            path == "/api/v1/uploads" or path.startswith("/api/v1/generations")
        ):
            self.send(handler, {"ok": False, "error": {"code": "SINGLE_TASK_USED", "message": ERROR_SECRET}}, 403, raw=True)
            return
        if path == "/api/v1/me":
            self.send(handler, {"id": account_id, "email": "local@example.test", "credits": 42, "expiresAt": None, "mode": "custom"})
        elif path == "/api/v1/models":
            self.send(handler, self.models)
        elif path == "/api/v1/uploads":
            message = BytesParser(policy=policy.default).parsebytes(
                f"Content-Type: {handler.headers['Content-Type']}\r\nMIME-Version: 1.0\r\n\r\n".encode() + data
            )
            parts = list(message.iter_parts())
            self.uploads.append({
                "field": parts[0].get_param("name", header="content-disposition"),
                "mime": parts[0].get_content_type(), "content": parts[0].get_payload(decode=True),
            })
            self.send(handler, {"key": f"upload-{len(self.uploads)}", "mimeType": "image/png", "width": 1, "height": 1, "sizeBytes": len(data)})
        elif path == "/api/v1/generations" and handler.command == "POST":
            if self.before_submit:
                self.before_submit(event)
            key = handler.headers.get("Idempotency-Key")
            identity = (account_id, key)
            if identity in self.jobs and self.jobs[identity]["body"] != data:
                self.send(handler, {"ok": False, "error": {"code": "IDEMPOTENCY_CONFLICT", "message": ERROR_SECRET}}, 409, raw=True)
                return
            if identity not in self.jobs:
                self.jobs[identity] = {"id": f"generation-{len(self.jobs) + 1}", "body": data}
            if self.drop_submit_responses:
                self.drop_submit_responses -= 1
                handler.connection.shutdown(socket.SHUT_RDWR)
                handler.connection.close()
                return
            self.send(handler, {"generationId": self.jobs[identity]["id"], "status": "PENDING", "estimatedCredits": 7}, 202)
        elif path.startswith("/api/v1/generations/"):
            generation_id = path.split("/")[4]
            if "/images/" in path:
                self.send(handler, {"b64_json": self.image_b64, "mimeType": self.image_mime, "width": 1, "height": 1})
            else:
                status = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]
                self.send(handler, {
                    "id": generation_id, "modelId": "live-image-v7", "status": status,
                    "progress": 100 if status == "SUCCEEDED" else 50, "costCredits": 7,
                    "errorCode": None if status == "SUCCEEDED" else "SERVER_CODE",
                    "errorMessage": ERROR_SECRET,
                    "images": [{"id": "image-1", "width": 1, "height": 1, "mimeType": "image/png"}] if status == "SUCCEEDED" else [],
                })
        elif path == "/api/agent/revoke":
            self.tokens.pop(token, None)
            self.send(handler, {"revoked": True})
        else:
            self.send(handler, {"ok": False, "error": {"code": "NOT_FOUND", "message": ERROR_SECRET}}, 404, raw=True)


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix=".chugao-test-", dir=TEST_DIR)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.output = self.root / "images"
        self.api = MockApi()
        self.addCleanup(self.api.close)
        self.store = chugao.CredentialStore(self.home / ".config" / "chugao", keyring_backend=None)
        self.clock = FakeClock()
        self.out, self.err = io.StringIO(), io.StringIO()
        self.stdout = redirect_stdout(self.out)
        self.stderr = redirect_stderr(self.err)
        self.stdout.__enter__()
        self.stderr.__enter__()
        self.addCleanup(self.stdout.__exit__, None, None, None)
        self.addCleanup(self.stderr.__exit__, None, None, None)

    def session(self, *, authorized=True, no_browser=True):
        if authorized:
            self.store.save(self.api.origin, credential())
        return chugao.Session(
            chugao.ApiClient(self.api.origin, timeout=2), self.store,
            no_browser=no_browser, client_name="local-test-device",
            sleep=self.clock.sleep, clock=self.clock.now,
        )

    def args(self, *extra):
        return chugao.parser().parse_args([
            "generate", "--model", "live-image-v7", "--prompt", "a red teapot",
            "--output-dir", str(self.output), *extra,
        ])

    def resume_args(self, path, *extra):
        return chugao.parser().parse_args(["resume", str(path), *extra])

    def state_path(self):
        return next((self.store.directory / "operations").glob("*.json"))

    def image(self, name, content=PNG):
        path = self.root / name
        # Test fixtures, credentials, and outputs all stay in this disposable home.
        with path.open("wb") as handle:
            handle.write(content)
        return path

    def cli(self, *arguments):
        environment = dict(os.environ, HOME=str(self.home), PYTHONDONTWRITEBYTECODE="1")
        return subprocess.run(
            [sys.executable, "-B", "-S", str(SCRIPT), "--base-url", self.api.origin, *arguments],
            cwd=self.root, env=environment, text=True, capture_output=True, timeout=10,
        )

    def assert_private(self, path, mode):
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), mode)

    def assert_no_secrets(self, value):
        for secret in (ACCESS_TOKEN, DEVICE_CODE, self.api.issued_token, ERROR_SECRET, base64.b64encode(PNG).decode()):
            self.assertNotIn(secret, value)

    def test_device_auth_pending_slow_down_and_success(self):
        self.api.oauth_results = ["authorization_pending", "slow_down", "success"]
        session = self.session(authorized=False)
        with mock.patch.object(chugao.webbrowser, "open") as browser:
            session.login()
        browser.assert_not_called()
        self.assertEqual(self.clock.sleeps, [5, 5, 10])
        self.assertIn(self.api.origin + "/app/agent/authorize?user_code=ABCD-EFGH", self.err.getvalue())
        self.assertIn("Code: ABCD-EFGH", self.err.getvalue())
        self.assert_no_secrets(self.err.getvalue())
        request = self.api.matching("POST", "/api/agent/device-authorization")[0]
        self.assertEqual(parse_qs(request["body"].decode()), {"client_id": ["chugao-skill"], "client_name": ["local-test-device"]})
        for event in self.api.matching("POST", "/api/agent/token"):
            self.assertEqual(parse_qs(event["body"].decode()), {
                "client_id": ["chugao-skill"], "grant_type": [chugao.DEVICE_GRANT], "device_code": [DEVICE_CODE],
            })
            self.assertNotIn("Authorization", event["headers"])
        self.assertEqual(self.store.load(self.api.origin)["access_token"], self.api.issued_token)

    def test_device_auth_opens_browser(self):
        session = self.session(authorized=False, no_browser=False)
        with mock.patch.object(chugao.webbrowser, "open", return_value=True) as browser:
            session.login()
        browser.assert_called_once_with(self.api.origin + "/app/agent/authorize?user_code=ABCD-EFGH")

    def test_auth_denial_and_server_expiry_stop_without_generation(self):
        for error in ("access_denied", "expired_token", "invalid_grant"):
            with self.subTest(error=error):
                self.api.oauth_results = [error]
                session = self.session(authorized=False)
                with self.assertRaises(chugao.CliError) as raised:
                    session.login()
                self.assert_no_secrets(str(raised.exception) + self.err.getvalue())
                self.assertIsNone(self.store.load(self.api.origin))
        self.assertEqual(len(self.api.jobs), 0)

    def test_pending_expires_at_device_deadline(self):
        self.api.auth_expires = 12
        self.api.oauth_results = ["authorization_pending"] * 10
        session = self.session(authorized=False)
        with self.assertRaisesRegex(chugao.CliError, "expired"):
            session.login()
        self.assertEqual(self.clock.sleeps, [5, 5, 2])
        self.assertEqual(len(self.api.matching("POST", "/api/agent/token")), 2)
        self.assertIsNone(self.store.load(self.api.origin))

    def test_reject_cross_origin_verification_link_before_opening(self):
        self.api.verification_override = "https://example.invalid/app/agent/authorize"
        with mock.patch.object(chugao.webbrowser, "open") as browser:
            with self.assertRaisesRegex(chugao.CliError, "configured origin"):
                self.session(authorized=False, no_browser=False).login()
        browser.assert_not_called()
        self.assertEqual(self.api.matching("POST", "/api/agent/token"), [])

    def test_auto_auth_generation_and_b64_output(self):
        result = chugao.generate(self.session(authorized=False), self.args())
        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(Path(result["images"][0]).read_bytes(), PNG)
        self.assertEqual(result["costCredits"], 7)
        body = json.loads(self.api.matching("POST", "/api/v1/generations")[0]["body"])
        self.assertEqual(body, {
            "modelId": "live-image-v7", "prompt": "a red teapot", "n": 1,
            "size": "768x768", "quality": "standard", "outputFormat": "png", "background": "opaque",
        })
        state = chugao.private_json(self.state_path())
        self.assertNotIn("b64_json", state)
        self.assert_no_secrets(json.dumps(state) + json.dumps(result) + self.err.getvalue())
        self.assert_private(self.state_path(), 0o600)
        self.assert_private(self.state_path().parent, 0o700)

    def test_ordered_references_and_state_exist_before_submission(self):
        first = self.image("z-first.png", PNG + b"first")
        second = self.image("a-second.png", PNG + b"second")
        snapshots = []
        self.api.before_submit = lambda event: snapshots.append(chugao.private_json(self.state_path()))
        result = chugao.generate(self.session(), self.args(
            "--reference", str(first), "--reference", str(second), "--reference", str(first), "--no-wait",
        ))
        self.assertEqual([item["content"] for item in self.api.uploads], [PNG + b"first", PNG + b"second", PNG + b"first"])
        self.assertTrue(all(item["field"] == "file" and item["mime"] == "image/png" for item in self.api.uploads))
        request = self.api.matching("POST", "/api/v1/generations")[0]
        body = json.loads(request["body"])
        self.assertEqual(body["referenceImageKeys"], ["upload-1", "upload-2", "upload-3"])
        self.assertEqual(snapshots[0]["requestBody"], body)
        self.assertEqual(snapshots[0]["operationId"], request["headers"]["Idempotency-Key"])
        self.assertEqual(snapshots[0]["accountId"], "account-1")
        self.assertIsNone(snapshots[0]["generationId"])
        self.assertEqual(result["status"], "PENDING")

    def test_lost_submit_response_replays_identical_body_key_without_uploading(self):
        reference = self.image("reference.png")
        self.api.drop_submit_responses = 1
        session = self.session()
        with self.assertRaisesRegex(chugao.CliError, "outcome is unknown"):
            chugao.generate(session, self.args("--reference", str(reference)))
        path = self.state_path()
        self.assertIsNone(chugao.private_json(path)["generationId"])
        self.assertIn(str(path), self.err.getvalue())
        self.assertEqual(len(self.api.jobs), 1)
        reference.unlink()
        self.api.models = []  # Replay does not revalidate/change frozen defaults.
        result = chugao.run_operation(session, path, self.resume_args(path))
        requests = self.api.matching("POST", "/api/v1/generations")
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0]["body"], requests[1]["body"])
        self.assertEqual(requests[0]["headers"]["Idempotency-Key"], requests[1]["headers"]["Idempotency-Key"])
        self.assertEqual(len(self.api.jobs), 1)
        self.assertEqual(len(self.api.uploads), 1)
        self.assertEqual(Path(result["images"][0]).read_bytes(), PNG)

    def test_resume_saved_generation_reauthorizes_without_submission(self):
        result = chugao.generate(self.session(), self.args("--no-wait"))
        self.store.save(self.api.origin, credential(expired=True))
        session = self.session(authorized=False)
        path = Path(result["state"])
        result = chugao.run_operation(session, path, self.resume_args(path))
        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(len(self.api.matching("POST", "/api/v1/generations")), 1)
        self.assertEqual(len(self.api.matching("POST", "/api/agent/token")), 1)

    def test_unknown_submit_cannot_replay_under_different_account(self):
        self.api.drop_submit_responses = 1
        with self.assertRaises(chugao.CliError):
            chugao.generate(self.session(), self.args())
        path = self.state_path()
        self.store.save(self.api.origin, credential(expired=True))
        self.api.authorized_account = "account-2"
        with self.assertRaisesRegex(chugao.CliError, "another account"):
            chugao.run_operation(self.session(authorized=False), path, self.resume_args(path))
        self.assertEqual(len(self.api.matching("POST", "/api/v1/generations")), 1)
        self.assertEqual(len(self.api.jobs), 1)

    def test_live_capability_validation_prevents_upload_and_submit(self):
        reference = self.image("reference.png")
        session = self.session()
        cases = [
            ("--model", "not-a-live-model"), ("--size", "invented-size"),
            ("--quality", "invented-quality"), ("--background", "invented-background"),
            ("--output-format", "invented-format"), ("--n", "2"), ("--prompt", "   "),
            tuple(argument for _ in range(5) for argument in ("--reference", str(reference))),
        ]
        for arguments in cases:
            with self.subTest(arguments=arguments):
                with self.assertRaises(chugao.CliError):
                    chugao.generate(session, self.args(*arguments))
        self.api.models[0]["capabilities"]["supportsReferenceImage"] = False
        with self.assertRaises(chugao.CliError):
            chugao.generate(session, self.args("--reference", str(reference)))
        self.api.models[0]["available"] = False
        with self.assertRaises(chugao.CliError):
            chugao.generate(session, self.args())
        self.assertEqual(self.api.uploads, [])
        self.assertEqual(self.api.matching("POST", "/api/v1/generations"), [])

    def test_timeout_then_resume_only_polls_existing_task(self):
        self.api.statuses = ["RUNNING"]
        session = self.session()
        with self.assertRaisesRegex(chugao.CliError, "still running"):
            chugao.generate(session, self.args("--wait-timeout", "2", "--poll-interval", "1"))
        path = self.state_path()
        self.api.statuses = ["SUCCEEDED"]
        result = chugao.run_operation(session, path, self.resume_args(path))
        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(len(self.api.matching("POST", "/api/v1/generations")), 1)

    def test_failed_and_canceled_tasks_never_submit_replacements(self):
        session = self.session()
        for status in ("FAILED", "CANCELED"):
            self.api.statuses = [status]
            with self.subTest(status=status), self.assertRaisesRegex(chugao.CliError, status.lower()) as raised:
                chugao.generate(session, self.args())
            self.assert_no_secrets(str(raised.exception) + self.err.getvalue())
        self.assertEqual(len(self.api.jobs), 2)
        self.assertEqual(len(self.api.matching("POST", "/api/v1/generations")), 2)

    def test_invalid_base64_can_resume_without_new_generation(self):
        self.api.image_b64 = "not-valid-base64-" + ERROR_SECRET
        session = self.session()
        with self.assertRaisesRegex(chugao.CliError, "invalid base64") as raised:
            chugao.generate(session, self.args())
        path = self.state_path()
        self.assert_no_secrets(str(raised.exception) + self.err.getvalue())
        self.assertEqual(list(self.output.iterdir()), [])
        self.api.image_b64 = base64.b64encode(PNG).decode()
        result = chugao.run_operation(session, path, self.resume_args(path))
        self.assertEqual(Path(result["images"][0]).read_bytes(), PNG)
        self.assertEqual(len(self.api.matching("POST", "/api/v1/generations")), 1)

    def test_saved_image_hash_skips_redownload_and_collision_preserves_files(self):
        session = self.session()
        result = chugao.generate(session, self.args("--no-wait"))
        self.output.mkdir(exist_ok=True)
        occupied = self.image("images/" + result["operationId"] + "-1.png", b"unrelated image")
        path = Path(result["state"])
        completed = chugao.run_operation(session, path, self.resume_args(path))
        self.assertEqual(occupied.read_bytes(), b"unrelated image")
        self.assertNotEqual(completed["images"][0], str(occupied))
        image_calls = len([event for event in self.api.events if "/images/" in event["path"]])
        chugao.run_operation(session, path, self.resume_args(path))
        self.assertEqual(len([event for event in self.api.events if "/images/" in event["path"]]), image_calls)

    def test_credential_fallback_has_private_permissions_and_repairs_modes(self):
        previous = os.umask(0)
        try:
            self.store.save(self.api.origin, credential())
        finally:
            os.umask(previous)
        self.assert_private(self.store.directory, 0o700)
        self.assert_private(self.store.path, 0o600)
        self.store.directory.chmod(0o755)
        self.store.path.chmod(0o644)
        self.assertEqual(self.store.load(self.api.origin)["access_token"], ACCESS_TOKEN)
        self.assert_private(self.store.directory, 0o700)
        self.assert_private(self.store.path, 0o600)

    def test_keychain_preferred_and_failed_write_uses_fallback(self):
        backend = mock.Mock()
        backend.get_password.return_value = None
        store = chugao.CredentialStore(self.store.directory, keyring_backend=backend)
        store.save(self.api.origin, credential())
        backend.set_password.assert_called_once()
        self.assertFalse(store.path.exists())
        backend.get_password.return_value = json.dumps(credential("stale-native-token"))
        backend.set_password.side_effect = RuntimeError(ERROR_SECRET)
        store.save(self.api.origin, credential())
        self.assertEqual(store.load(self.api.origin)["access_token"], ACCESS_TOKEN)
        self.assert_private(store.path, 0o600)

    def test_native_keyring_does_not_select_plaintext_backend(self):
        backend = type("PlaintextKeyring", (), {"priority": 1})()
        backend.__class__.__module__ = "keyrings.alt.file"
        with mock.patch.object(chugao.importlib, "import_module", return_value=mock.Mock(get_keyring=lambda: backend)):
            self.assertIsNone(chugao.native_keyring())

    def test_credentials_are_isolated_by_origin(self):
        production_token = "production-only-secret"
        self.store.save(chugao.DEFAULT_BASE_URL, credential(production_token))
        chugao.live_models(self.session(authorized=False))
        self.assertEqual(self.store.load(chugao.DEFAULT_BASE_URL)["access_token"], production_token)
        self.assertTrue(self.api.events)
        for event in self.api.events:
            self.assertNotIn(production_token, str(event["headers"]) + event["body"].decode(errors="replace"))

    def test_redirects_never_receive_credentials_at_destination(self):
        destination = MockApi()
        self.addCleanup(destination.close)
        client = chugao.ApiClient(self.api.origin)
        for code in (301, 302, 303, 307, 308):
            self.api.redirect = ("/api/v1/models", code, destination.origin + "/trap")
            with self.subTest(code=code), self.assertRaisesRegex(chugao.CliError, "redirect"):
                client.request("GET", "/api/v1/models", token=ACCESS_TOKEN)
        self.assertEqual(destination.events, [])

    def test_reject_other_origins_and_absolute_request_paths(self):
        for origin in (
            "https://example.invalid", "http://chugao.art", "http://192.168.1.2:8080",
            "http://localhost.evil.invalid", "http://user:secret@localhost:8080",
            "http://localhost/api", "http://localhost?target=x", "https://chugao.art:444",
        ):
            with self.subTest(origin=origin), self.assertRaises(chugao.CliError):
                chugao.ApiClient(origin)
        with self.assertRaises(chugao.CliError):
            chugao.ApiClient(self.api.origin).request("GET", "https://example.invalid/api/v1/models", token=ACCESS_TOKEN)
        self.assertEqual(self.api.events, [])

    def test_resume_rejects_origin_and_body_changes_before_any_request(self):
        result = chugao.generate(self.session(), self.args("--no-wait"))
        path = Path(result["state"])
        state = chugao.private_json(path)
        state["origin"] = "http://localhost:9"
        chugao.atomic_json(path, state)
        count = len(self.api.events)
        session = self.session(authorized=False)
        with self.assertRaisesRegex(chugao.CliError, "origin"):
            chugao.run_operation(session, path, self.resume_args(path))
        state["origin"] = self.api.origin
        state["requestBody"]["prompt"] = "a changed paid request"
        chugao.atomic_json(path, state)
        with self.assertRaisesRegex(chugao.CliError, "frozen request"):
            chugao.run_operation(session, path, self.resume_args(path))
        self.assertEqual(len(self.api.events), count)

    def test_bearer_401_reauthorizes_once(self):
        session = self.session()
        self.api.tokens.pop(ACCESS_TOKEN)
        account = session.me()
        self.assertEqual(account["id"], "account-1")
        self.assertEqual(len(self.api.matching("GET", "/api/v1/me")), 2)
        self.assertEqual(len(self.api.matching("POST", "/api/agent/token")), 1)

    def test_single_task_used_reauth_retries_identical_submission(self):
        self.api.used_single_tokens.add(ACCESS_TOKEN)
        result = chugao.generate(self.session(), self.args("--no-wait"))
        requests = self.api.matching("POST", "/api/v1/generations")
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0]["body"], requests[1]["body"])
        self.assertEqual(requests[0]["headers"]["Idempotency-Key"], result["operationId"])
        self.assertEqual(requests[0]["headers"]["Idempotency-Key"], requests[1]["headers"]["Idempotency-Key"])
        self.assertNotEqual(requests[0]["headers"]["Authorization"], requests[1]["headers"]["Authorization"])
        self.assertEqual(len(self.api.jobs), 1)
        self.assertEqual(len(self.api.matching("POST", "/api/agent/token")), 1)
        self.assert_no_secrets(self.err.getvalue())

    def test_single_task_used_upload_reauth_preserves_reference_request(self):
        self.api.used_single_tokens.add(ACCESS_TOKEN)
        reference = self.image("reference.png")
        chugao.generate(self.session(), self.args("--reference", str(reference), "--no-wait"))
        uploads = self.api.matching("POST", "/api/v1/uploads")
        self.assertEqual(len(uploads), 2)
        self.assertEqual(uploads[0]["body"], uploads[1]["body"])
        self.assertEqual(uploads[0]["headers"]["Content-Type"], uploads[1]["headers"]["Content-Type"])
        self.assertEqual(len(self.api.uploads), 1)
        self.assertEqual(self.api.uploads[0]["content"], PNG)
        self.assertEqual(len(self.api.matching("POST", "/api/v1/generations")), 1)
        self.assertEqual(len(self.api.matching("POST", "/api/agent/token")), 1)

    def test_single_task_used_read_reauth_never_resubmits_saved_task(self):
        session = self.session()
        result = chugao.generate(session, self.args("--no-wait"))
        self.api.used_single_tokens.add(ACCESS_TOKEN)
        self.api.statuses = ["SUCCEEDED"]
        path = Path(result["state"])
        completed = chugao.run_operation(session, path, self.resume_args(path))
        self.assertEqual(Path(completed["images"][0]).read_bytes(), PNG)
        self.assertEqual(len(self.api.matching("GET", "/api/v1/generations/" + result["generationId"])), 2)
        self.assertEqual(len(self.api.matching("POST", "/api/v1/generations")), 1)
        self.assertEqual(len(self.api.matching("POST", "/api/agent/token")), 1)

    def test_single_task_used_reauthorization_is_limited_to_once(self):
        self.api.used_single_tokens.update((ACCESS_TOKEN, self.api.issued_token))
        with self.assertRaises(chugao.ApiError) as raised:
            chugao.generate(self.session(), self.args("--no-wait"))
        self.assertEqual(raised.exception.code, "SINGLE_TASK_USED")
        requests = self.api.matching("POST", "/api/v1/generations")
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0]["body"], requests[1]["body"])
        self.assertEqual(requests[0]["headers"]["Idempotency-Key"], requests[1]["headers"]["Idempotency-Key"])
        self.assertEqual(len(self.api.matching("POST", "/api/agent/token")), 1)
        self.assertEqual(len(self.api.jobs), 0)
        self.assert_no_secrets(str(raised.exception) + self.err.getvalue())

    def test_other_403_codes_do_not_reauthorize_or_resubmit(self):
        for code in ("MODERATION_REJECTED", "AUTHORIZATION_EXPIRED", "single_task_used", "FORBIDDEN"):
            with self.subTest(code=code):
                self.api.errors["/api/v1/generations"] = (403, {"ok": False, "error": {"code": code, "message": ERROR_SECRET}})
                before = len(self.api.matching("POST", "/api/v1/generations"))
                with self.assertRaises(chugao.ApiError):
                    chugao.generate(self.session(), self.args("--no-wait"))
                self.assertEqual(len(self.api.matching("POST", "/api/v1/generations")), before + 1)
        self.assertEqual(len(self.api.matching("POST", "/api/agent/token")), 0)
        self.assertEqual(len(self.api.jobs), 0)

    def test_logout_revokes_and_clears_only_current_origin(self):
        self.store.save(self.api.origin, credential())
        self.store.save(chugao.DEFAULT_BASE_URL, credential("production-only-secret"))
        result = chugao.logout(chugao.ApiClient(self.api.origin), self.store)
        self.assertTrue(result["revoked"])
        self.assertIsNone(self.store.load(self.api.origin))
        self.assertNotIn(ACCESS_TOKEN, self.api.tokens)
        self.assertIsNotNone(self.store.load(chugao.DEFAULT_BASE_URL))
        self.assertEqual(self.api.matching("POST", "/api/agent/device-authorization"), [])

    def test_logout_failure_still_removes_local_credential(self):
        self.store.save(self.api.origin, credential())
        self.api.errors["/api/agent/revoke"] = (503, {"ok": False, "error": {"code": "UNAVAILABLE", "message": ERROR_SECRET}})
        with self.assertRaisesRegex(chugao.CliError, "not confirmed") as raised:
            chugao.logout(chugao.ApiClient(self.api.origin), self.store)
        self.assertIsNone(self.store.load(self.api.origin))
        self.assert_no_secrets(str(raised.exception))

    def test_real_cli_models_status_generation_and_resume_stdout(self):
        self.store.save(self.api.origin, credential())
        models = self.cli("models")
        self.assertEqual(models.returncode, 0, models.stderr)
        parsed = json.loads(models.stdout)
        self.assertEqual(parsed[0]["id"], "live-image-v7")
        self.assertEqual(parsed[0]["pricingRules"][0]["credits"], 7)
        self.assertNotIn("upstream", parsed[0])
        status = self.cli("status")
        self.assertEqual(status.returncode, 0, status.stderr)
        self.assertEqual(json.loads(status.stdout)["credits"], 42)
        result = self.cli("generate", "--model", "live-image-v7", "--prompt", "a teapot", "--no-wait")
        self.assertEqual(result.returncode, 0, result.stderr)
        operation = json.loads(result.stdout)["operationId"]
        self.api.statuses = ["SUCCEEDED"]
        resumed = self.cli("resume", operation)
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertEqual(Path(json.loads(resumed.stdout)["images"][0]).read_bytes(), PNG)
        self.assert_no_secrets(models.stdout + models.stderr + status.stdout + result.stdout + result.stderr + resumed.stdout + resumed.stderr)
        self.assertEqual(len(self.api.jobs), 1)

    def test_real_cli_api_errors_do_not_print_response_secrets(self):
        self.store.save(self.api.origin, credential())
        self.api.errors["/api/v1/models"] = (500, {"ok": False, "error": {"code": ERROR_SECRET + self.api.image_b64, "message": ACCESS_TOKEN + ERROR_SECRET + self.api.image_b64}})
        result = self.cli("models")
        self.assertEqual(result.returncode, 1)
        self.assert_no_secrets(result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertEqual(result.stderr.strip(), "Error: The API rejected the request (HTTP 500).")

    def test_real_cli_known_error_codes_show_local_guidance_without_secrets(self):
        self.store.save(self.api.origin, credential())
        cases = {
            "INSUFFICIENT_CREDITS": (402, "Add credits"),
            "MODERATION_REJECTED": (403, "Review the prompt"),
            "RATE_LIMITED": (429, "Wait before retrying"),
            "SINGLE_TASK_USED": (403, "Run login"),
            "IDEMPOTENCY_CONFLICT": (409, "original, unchanged operation state"),
            "MODEL_NOT_AVAILABLE": (503, "Run models"),
            "AUTHORIZATION_EXPIRED": (403, "Run login"),
            "REFERENCE_IMAGE_NOT_FOUND": (404, "account access"),
        }
        for code, (status, guidance) in cases.items():
            with self.subTest(code=code):
                self.api.errors["/api/v1/models"] = (status, {"ok": False, "error": {
                    "code": code, "message": ACCESS_TOKEN + ERROR_SECRET + self.api.image_b64,
                }})
                result = self.cli("models")
                self.assertEqual(result.returncode, 1)
                self.assertIn(guidance, result.stderr)
                self.assert_no_secrets(result.stdout + result.stderr)
                self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
