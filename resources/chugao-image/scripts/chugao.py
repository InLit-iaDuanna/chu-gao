#!/usr/bin/env python3
"""Chugao's portable image CLI. Requires Python 3.10 or newer."""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import http.client
import importlib
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import socket
import sys
import tempfile
import time
from typing import Any
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser


DEFAULT_BASE_URL = "https://chugao.art"
CLIENT_ID = "chugao-skill"
DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
STATUSES = {"PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"}
PUBLIC_MODEL_FIELDS = (
    "id", "displayName", "available", "capabilities", "defaults", "costTable",
    "pricingRules",
)
AUTO_KEYRING = object()
API_ERROR_MESSAGES = {
    "INSUFFICIENT_CREDITS": "Not enough credits. Add credits in Chugao before retrying",
    "MODERATION_REJECTED": "The request was rejected by moderation. Review the prompt and reference images",
    "RATE_LIMITED": "The request rate limit was reached. Wait before retrying; resume any saved operation",
    "SINGLE_TASK_USED": "This single-use authorization has already been used. Run login, then resume any saved operation",
    "IDEMPOTENCY_CONFLICT": "The idempotency key is tied to a different request. Resume the original, unchanged operation state",
    "MODEL_NOT_AVAILABLE": "The requested model is unavailable. Run models to check availability; no fallback model was selected",
    "AUTHORIZATION_EXPIRED": "Authorization has expired. Run login, then resume any saved operation",
    "REFERENCE_IMAGE_NOT_FOUND": "A reference image is missing or inaccessible. Check reference image availability and account access",
}


class CliError(Exception):
    """An error whose message is safe to display."""


class TransportError(CliError):
    def __init__(self):
        super().__init__("The server response was not received reliably.")


class ProtocolError(CliError):
    def __init__(self):
        super().__init__("The server returned an invalid response.")


class ApiError(CliError):
    def __init__(self, status: int, code: str = ""):
        self.status = status
        self.code = code
        # Never display server error text: it can contain upstream credentials.
        message = API_ERROR_MESSAGES.get(code, "The API rejected the request")
        super().__init__(f"{message} (HTTP {status}).")


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def positive_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float)) and not isinstance(value, bool)
        and math.isfinite(value) and value > 0
    )


def nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def configured_origin(value: str) -> str:
    """Only production HTTPS or explicit HTTP loopback development is allowed."""
    try:
        if any(ord(char) <= 32 or ord(char) == 127 for char in value):
            raise ValueError
        parts = urllib.parse.urlsplit(value)
        if (
            parts.username is not None or parts.password is not None
            or parts.path not in ("", "/") or parts.query or parts.fragment
        ):
            raise ValueError
        port = parts.port
        if parts.scheme == "https" and parts.hostname == "chugao.art":
            if port not in (None, 443):
                raise ValueError
            return DEFAULT_BASE_URL
        if parts.scheme == "http" and parts.hostname in ("localhost", "127.0.0.1", "::1"):
            if port is not None and not 1 <= port <= 65535:
                raise ValueError
            host = "[::1]" if parts.hostname == "::1" else parts.hostname
            suffix = f":{port}" if port not in (None, 80) else ""
            return f"http://{host}{suffix}"
    except (ValueError, TypeError):
        pass
    raise CliError("Use https://chugao.art or an http://localhost loopback origin.")


def verification_url(value: Any, origin: str) -> str:
    try:
        if not nonempty_string(value) or any(ord(c) <= 32 or ord(c) == 127 for c in value):
            raise ValueError
        parts = urllib.parse.urlsplit(value)
        if parts.username is not None or parts.password is not None or parts.fragment:
            raise ValueError
        if configured_origin(f"{parts.scheme}://{parts.netloc}") != origin:
            raise ValueError
        if not parts.path.startswith("/"):
            raise ValueError
        return value
    except (ValueError, CliError):
        raise CliError("The authorization link does not match the configured origin.") from None


def private_directory(path: Path) -> None:
    if path.is_symlink():
        raise CliError("Private storage must not be a symbolic link.")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.chmod(0o700)


def private_json(path: Path) -> Any:
    if path.is_symlink():
        raise CliError("Private storage must not be a symbolic link.")
    path.chmod(0o600)
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (ValueError, UnicodeError):
        raise CliError("Private storage contains invalid JSON.") from None


def atomic_json(path: Path, value: Any) -> None:
    private_directory(path.parent)
    if path.is_symlink():
        raise CliError("Private storage must not be a symbolic link.")
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(canonical_json(value))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        if os.name == "posix":
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def native_keyring() -> Any:
    """Prefer native keychains, not optional plaintext keyring backends."""
    try:
        backend = importlib.import_module("keyring").get_keyring()
        candidates = getattr(backend, "backends", [backend])
        for candidate in candidates:
            module = type(candidate).__module__
            if module.startswith((
                "keyring.backends.macOS", "keyring.backends.Windows",
                "keyring.backends.SecretService", "keyring.backends.kwallet",
                "keyring.backends.libsecret",
            )) and candidate.priority > 0:
                return candidate
    except Exception:
        pass
    return None


def valid_credential(value: Any) -> bool:
    return (
        isinstance(value, dict) and nonempty_string(value.get("access_token"))
        and all(33 <= ord(c) <= 126 for c in value["access_token"])
        and positive_number(value.get("expires_at"))
        and str(value.get("token_type", "")).lower() == "bearer"
        and isinstance(value.get("scope", ""), str)
    )


class CredentialStore:
    def __init__(self, directory: Path | None = None, keyring_backend: Any = AUTO_KEYRING):
        self.directory = directory or Path.home() / ".config" / "chugao"
        self.path = self.directory / "credentials.json"
        self.keyring = native_keyring() if keyring_backend is AUTO_KEYRING else keyring_backend

    def _file_records(self) -> dict:
        if not self.path.exists() and not self.path.is_symlink():
            return {}
        private_directory(self.directory)
        value = private_json(self.path)
        if (
            not isinstance(value, dict) or value.get("version") != 1
            or not isinstance(value.get("credentials"), dict)
        ):
            raise CliError("The credential cache is invalid.")
        return value["credentials"]

    def _remove_file_record(self, origin: str) -> None:
        records = self._file_records()
        if origin in records:
            del records[origin]
            if records:
                atomic_json(self.path, {"version": 1, "credentials": records})
            else:
                self.path.unlink(missing_ok=True)

    def load(self, origin: str) -> dict | None:
        # A fallback written after a keychain failure supersedes an older entry.
        value = self._file_records().get(origin)
        if value is None and self.keyring is not None:
            try:
                serialized = self.keyring.get_password(CLIENT_ID, origin)
                value = json.loads(serialized) if serialized else None
            except Exception:
                value = None
        if value is not None and not valid_credential(value):
            raise CliError("The cached authorization is invalid; run logout, then login.")
        return value

    def save(self, origin: str, credential: dict) -> None:
        if not valid_credential(credential):
            raise ProtocolError()
        if self.keyring is not None:
            try:
                self.keyring.set_password(CLIENT_ID, origin, canonical_json(credential).decode())
            except Exception:
                pass
            else:
                self._remove_file_record(origin)
                return
        records = self._file_records()
        records[origin] = credential
        atomic_json(self.path, {"version": 1, "credentials": records})

    def clear(self, origin: str) -> None:
        self._remove_file_record(origin)
        if self.keyring is not None:
            try:
                if self.keyring.get_password(CLIENT_ID, origin) is not None:
                    self.keyring.delete_password(CLIENT_ID, origin)
            except Exception:
                raise CliError("Could not clear the native keychain entry; retry logout.") from None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ApiClient:
    def __init__(self, base_url: str = DEFAULT_BASE_URL, timeout: float = 30):
        self.origin = configured_origin(base_url)
        self.timeout = timeout
        # Ignore proxy environment variables as well as all HTTP redirects.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(
        self, method: str, path: str, *, token: str | None = None,
        payload: Any = None, form: dict | None = None, data: bytes | None = None,
        content_type: str | None = None, idempotency_key: str | None = None,
        oauth: bool = False,
    ) -> Any:
        parts = urllib.parse.urlsplit(path)
        if (
            not path.startswith("/api/") or parts.scheme or parts.netloc or parts.fragment
            or any(ord(c) <= 32 or ord(c) == 127 for c in path)
        ):
            raise CliError("API requests must stay on the configured origin.")
        headers = {"Accept": "application/json", "User-Agent": "chugao-skill/1"}
        if token is not None:
            if not token or not all(33 <= ord(c) <= 126 for c in token):
                raise CliError("The cached authorization is invalid.")
            headers["Authorization"] = f"Bearer {token}"
        if payload is not None:
            data, content_type = canonical_json(payload), "application/json"
        elif form is not None:
            data = urllib.parse.urlencode(form).encode("utf-8")
            content_type = "application/x-www-form-urlencoded"
        if content_type:
            headers["Content-Type"] = content_type
        if idempotency_key is not None:
            headers["Idempotency-Key"] = str(uuid.UUID(idempotency_key))
        request = urllib.request.Request(self.origin + path, data=data, headers=headers, method=method)
        try:
            try:
                response = self.opener.open(request, timeout=self.timeout)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                status = response.code
                if 300 <= status < 400:
                    raise CliError("The API returned a redirect; no redirect was followed.")
                raw = response.read(128 * 1024 * 1024 + 1)
            if len(raw) > 128 * 1024 * 1024:
                raise ProtocolError()
        except (urllib.error.URLError, OSError, http.client.HTTPException):
            raise TransportError() from None
        try:
            result = json.loads(raw)
        except (ValueError, UnicodeError):
            if not 200 <= status < 300:
                raise ApiError(status) from None
            raise ProtocolError() from None
        if not isinstance(result, dict):
            raise ProtocolError()
        if not 200 <= status < 300 or (not oauth and result.get("ok") is False) or (oauth and "error" in result):
            error = result.get("error")
            code = error.get("code", "") if isinstance(error, dict) else error
            raise ApiError(status, code if isinstance(code, str) else "")
        if oauth:
            return result
        if result.get("ok") is not True or "data" not in result:
            raise ProtocolError()
        return result["data"]


class Session:
    def __init__(
        self, client: ApiClient, store: CredentialStore, *, no_browser: bool = False,
        client_name: str | None = None, sleep=time.sleep, clock=time.monotonic,
    ):
        self.client = client
        self.store = store
        self.no_browser = no_browser
        self.client_name = client_name or socket.gethostname()
        self.sleep = sleep
        self.clock = clock
        self.credential = store.load(client.origin)
        self.account_token: str | None = None
        self.account_id: str | None = None

    def login(self) -> None:
        response = self.client.request(
            "POST", "/api/agent/device-authorization", oauth=True,
            form={"client_id": CLIENT_ID, "client_name": self.client_name},
        )
        device_code, user_code = response.get("device_code"), response.get("user_code")
        lifetime, interval = response.get("expires_in"), response.get("interval", 5)
        if (
            not nonempty_string(device_code) or not nonempty_string(user_code)
            or len(user_code) > 128 or any(ord(c) < 32 or ord(c) == 127 for c in user_code)
            or not positive_number(lifetime) or not positive_number(interval)
        ):
            raise ProtocolError()
        verification_url(response.get("verification_uri"), self.client.origin)
        link = verification_url(response.get("verification_uri_complete"), self.client.origin)
        deadline = self.clock() + lifetime
        print(f"Authorize: {link}\nCode: {user_code}", file=sys.stderr, flush=True)
        if not self.no_browser:
            try:
                webbrowser.open(link)
            except Exception:
                print("Open the authorization link in your browser.", file=sys.stderr)
        while True:
            remaining = deadline - self.clock()
            if remaining <= 0:
                raise CliError("Device authorization expired; run login again.")
            self.sleep(min(interval, remaining))
            if self.clock() >= deadline:
                raise CliError("Device authorization expired; run login again.")
            try:
                response = self.client.request(
                    "POST", "/api/agent/token", oauth=True,
                    form={"grant_type": DEVICE_GRANT, "client_id": CLIENT_ID, "device_code": device_code},
                )
            except ApiError as error:
                if error.code == "authorization_pending":
                    continue
                if error.code == "slow_down":
                    interval += 5
                    continue
                if error.code == "access_denied":
                    raise CliError("Device authorization was denied in the browser.") from None
                if error.code in ("expired_token", "invalid_grant"):
                    raise CliError("Device authorization expired or is invalid; run login again.") from None
                raise
            if not positive_number(response.get("expires_in")):
                raise ProtocolError()
            credential = {
                "access_token": response.get("access_token"),
                "token_type": response.get("token_type"),
                "expires_at": time.time() + response["expires_in"],
                "scope": response.get("scope", ""),
            }
            self.store.save(self.client.origin, credential)
            self.credential = credential
            self.account_token = self.account_id = None
            return

    def request(self, method: str, path: str, *, account_id: str | None = None, **kwargs) -> Any:
        for attempt in range(2):
            if self.credential is None or self.credential["expires_at"] <= time.time():
                self.login()
            token = self.credential["access_token"]
            try:
                if account_id is not None:
                    if self.account_token != token:
                        account = self.client.request("GET", "/api/v1/me", token=token)
                        self._remember_account(account, token)
                    if self.account_id != account_id:
                        raise CliError("This operation belongs to another account; log in with the original account.")
                return self.client.request(method, path, token=token, **kwargs)
            except ApiError as error:
                reauthorize = error.status == 401 or (
                    error.status == 403 and error.code == "SINGLE_TASK_USED"
                )
                if not reauthorize or attempt:
                    raise
                self.credential = None
                self.account_token = self.account_id = None
        raise ProtocolError()

    def _remember_account(self, value: Any, token: str) -> None:
        if not isinstance(value, dict) or not nonempty_string(value.get("id")):
            raise ProtocolError()
        self.account_id, self.account_token = value["id"], token

    def me(self) -> dict:
        value = self.request("GET", "/api/v1/me")
        self._remember_account(value, self.credential["access_token"])
        return value


def live_models(session: Session, account_id: str | None = None) -> list[dict]:
    models = session.request("GET", "/api/v1/models", account_id=account_id)
    if not isinstance(models, list) or any(
        not isinstance(model, dict) or not nonempty_string(model.get("id"))
        or not isinstance(model.get("capabilities"), dict)
        or not isinstance(model.get("defaults"), dict) for model in models
    ):
        raise ProtocolError()
    return [{key: model[key] for key in PUBLIC_MODEL_FIELDS if key in model} for model in models]


def generation_body(args: argparse.Namespace, models: list[dict], reference_count: int) -> dict:
    model = next((item for item in models if item["id"] == args.model), None)
    if model is None:
        raise CliError("The requested model is not in the live model list; run models.")
    if model.get("available") is not True:
        raise CliError("The requested model is unavailable; no other model was selected.")
    capabilities = model["capabilities"]
    max_n = capabilities.get("maxN")
    if args.n != 1 or not isinstance(max_n, int) or isinstance(max_n, bool) or max_n < 1:
        raise CliError("This CLI requires n=1 and a model that supports it.")
    limit = capabilities.get("maxPromptLength")
    if isinstance(limit, int) and limit > 0 and len(args.prompt) > limit:
        raise CliError("The prompt exceeds this model's live length limit.")
    if reference_count:
        maximum = capabilities.get("maxReferenceImages")
        if capabilities.get("supportsReferenceImage") is not True:
            raise CliError("The requested model does not support reference images.")
        if not isinstance(maximum, int) or isinstance(maximum, bool) or reference_count > maximum:
            raise CliError("Too many reference images for the requested model.")
    body = {"modelId": args.model, "prompt": args.prompt, "n": 1}
    for flag, field, capability in (
        ("size", "size", "sizes"), ("quality", "quality", "qualities"),
        ("background", "background", "backgrounds"),
        ("output_format", "outputFormat", "outputFormats"),
    ):
        value = getattr(args, flag)
        if value is None:
            value = model["defaults"].get(field)
        if value is None:
            continue
        choices = capabilities.get(capability, [])
        if not isinstance(value, str) or not isinstance(choices, list) or value not in choices:
            raise CliError(f"Unsupported {field} for the requested model; run models.")
        body[field] = value
    return body


def local_references(paths: list[str]) -> list[tuple[bytes, str, str]]:
    references = []
    for index, name in enumerate(paths, start=1):
        path = Path(name).expanduser()
        if not path.is_file():
            raise CliError(f"Reference {index} is not a local file.")
        mime, _ = mimetypes.guess_type(path.name)
        if mime is None or not mime.startswith("image/"):
            raise CliError(f"Reference {index} needs a recognized image file extension.")
        content = path.read_bytes()
        if not content:
            raise CliError(f"Reference {index} is empty.")
        extension = path.suffix.lower()
        if re.fullmatch(r"\.[a-z0-9]{1,10}", extension) is None:
            extension = ".img"
        references.append((content, mime, f"reference-{index}{extension}"))
    return references


def upload_reference(session: Session, reference: tuple[bytes, str, str], account_id: str) -> str:
    content, mime, filename = reference
    boundary = f"chugao-{uuid.uuid4().hex}"
    while boundary.encode() in content:
        boundary = f"chugao-{uuid.uuid4().hex}"
    data = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode("ascii") + content + f"\r\n--{boundary}--\r\n".encode("ascii")
    response = session.request(
        "POST", "/api/v1/uploads", account_id=account_id, data=data,
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    if not isinstance(response, dict) or not nonempty_string(response.get("key")):
        raise ProtocolError()
    return response["key"]


class OperationLock:
    """OS locks are released on a crash; the small lock file can remain."""

    def __init__(self, path: Path):
        self.path = path.with_suffix(".lock")
        self.descriptor: int | None = None

    def __enter__(self):
        private_directory(self.path.parent)
        if self.path.is_symlink():
            raise CliError("The operation lock must not be a symbolic link.")
        flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
        self.descriptor = os.open(self.path, flags, 0o600)
        try:
            if os.name == "posix":
                import fcntl
                os.fchmod(self.descriptor, 0o600)
                fcntl.flock(self.descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            elif os.name == "nt":
                import msvcrt
                os.write(self.descriptor, b"\0")
                os.lseek(self.descriptor, 0, os.SEEK_SET)
                msvcrt.locking(self.descriptor, msvcrt.LK_NBLCK, 1)
            else:
                raise CliError("Operation locking is not supported on this platform.")
        except OSError:
            os.close(self.descriptor)
            self.descriptor = None
            raise CliError("This operation is already in use; wait before resuming.") from None
        return self

    def __exit__(self, *args):
        if self.descriptor is not None:
            os.close(self.descriptor)


def operation_path(store: CredentialStore, value: str) -> Path:
    directory = store.directory / "operations"
    try:
        operation_id = str(uuid.UUID(value))
        return directory / f"{operation_id}.json"
    except ValueError:
        path = Path(value).expanduser().absolute()
        if path.is_symlink() or path.parent.resolve() != directory.resolve():
            raise CliError("Resume requires an operation ID or a file in the operation cache.") from None
        return path


def read_operation(path: Path, origin: str) -> dict:
    state = private_json(path)
    if not isinstance(state, dict) or state.get("version") != 1:
        raise CliError("The operation state is invalid.")
    if state.get("origin") != origin:
        raise CliError("The operation origin differs from --base-url; no request was sent.")
    try:
        operation_id = state["operationId"]
        if str(uuid.UUID(operation_id)) != operation_id:
            raise ValueError
        body = state["requestBody"]
        allowed = {"modelId", "prompt", "size", "quality", "background", "outputFormat", "n", "referenceImageKeys"}
        if (
            not isinstance(body, dict) or set(body) - allowed
            or not nonempty_string(body.get("modelId")) or not nonempty_string(body.get("prompt"))
            or type(body.get("n")) is not int or body["n"] != 1
            or not nonempty_string(state.get("accountId"))
            or not isinstance(state.get("outputDir"), str) or not Path(state["outputDir"]).is_absolute()
            or state.get("status") not in STATUSES | {"PREPARED"}
            or not isinstance(state.get("images"), list)
            or (state.get("generationId") is not None and not nonempty_string(state["generationId"]))
            or not isinstance(body.get("referenceImageKeys", []), list)
            or any(not nonempty_string(key) for key in body.get("referenceImageKeys", []))
            or any(not isinstance(body[key], str) for key in ("size", "quality", "background", "outputFormat") if key in body)
            or hashlib.sha256(canonical_json(body)).hexdigest() != state.get("requestSha256")
        ):
            raise ValueError
    except (KeyError, ValueError, TypeError, AttributeError):
        raise CliError("The saved operation is invalid or its frozen request was changed.") from None
    return state


def numeric_field(target: dict, source: dict, key: str) -> None:
    value = source.get(key)
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        target[key] = value


def submit_operation(session: Session, path: Path, state: dict) -> None:
    try:
        response = session.request(
            "POST", "/api/v1/generations", account_id=state["accountId"],
            payload=state["requestBody"], idempotency_key=state["operationId"],
        )
        if (
            not isinstance(response, dict) or not nonempty_string(response.get("generationId"))
            or response.get("status") not in STATUSES
        ):
            raise ProtocolError()
    except (TransportError, ProtocolError):
        raise CliError("Submission outcome is unknown. Resume the saved state; do not start a new generation.") from None
    except ApiError as error:
        if error.status >= 500 or error.status == 408:
            raise CliError("Submission outcome is unknown. Resume the saved state; do not start a new generation.") from None
        raise
    state["generationId"] = response["generationId"]
    state["status"] = response["status"]
    numeric_field(state, response, "estimatedCredits")
    atomic_json(path, state)


def write_image(directory: Path, stem: str, extension: str, content: bytes) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for collision in range(1000):
        suffix = f"-{collision}" if collision else ""
        path = directory / f"{stem}{suffix}{extension}"
        if path.is_symlink():
            continue
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            if path.is_file() and path.read_bytes() == content:
                return path
            continue
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return path
    raise CliError("Too many output filename collisions.")


def download_images(session: Session, path: Path, state: dict, images: Any) -> None:
    if (
        not isinstance(images, list) or not images
        or any(not isinstance(item, dict) or not nonempty_string(item.get("id")) for item in images)
        or len({item["id"] for item in images}) != len(images)
    ):
        raise ProtocolError()
    directory = Path(state["outputDir"])
    generation_id = urllib.parse.quote(state["generationId"], safe="")
    extensions = {
        "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
        "image/gif": ".gif", "image/avif": ".avif", "image/tiff": ".tiff", "image/bmp": ".bmp",
    }
    for index, image in enumerate(images, start=1):
        cached = next((entry for entry in state["images"] if isinstance(entry, dict) and entry.get("imageId") == image["id"]), None)
        if cached and isinstance(cached.get("path"), str):
            saved = Path(cached["path"])
            if (
                saved.parent == directory and saved.name.startswith(state["operationId"] + "-")
                and not saved.is_symlink() and saved.is_file()
                and hashlib.sha256(saved.read_bytes()).hexdigest() == cached.get("sha256")
            ):
                continue
        image_id = urllib.parse.quote(image["id"], safe="")
        response = session.request(
            "GET", f"/api/v1/generations/{generation_id}/images/{image_id}",
            account_id=state["accountId"],
        )
        if not isinstance(response, dict) or not isinstance(response.get("b64_json"), str):
            raise ProtocolError()
        extension = extensions.get(response.get("mimeType"))
        if extension is None:
            raise CliError("The server returned an unsupported image MIME type.")
        try:
            content = base64.b64decode(response["b64_json"], validate=True)
        except (ValueError, binascii.Error):
            raise CliError("The server returned invalid base64 image data.") from None
        if not content:
            raise CliError("The server returned an empty image.")
        output = write_image(directory, f"{state['operationId']}-{index}", extension, content)
        entry = {"imageId": image["id"], "path": str(output), "sha256": hashlib.sha256(content).hexdigest()}
        state["images"] = [item for item in state["images"] if not isinstance(item, dict) or item.get("imageId") != image["id"]]
        state["images"].append(entry)
        atomic_json(path, state)


def operation_summary(path: Path, state: dict) -> dict:
    result = {
        "operationId": state["operationId"], "generationId": state["generationId"],
        "status": state["status"], "state": str(path),
        "images": [image["path"] for image in state["images"] if isinstance(image, dict) and "path" in image],
    }
    for key in ("estimatedCredits", "costCredits"):
        numeric_field(result, state, key)
    return result


def run_operation(session: Session, path: Path, args: argparse.Namespace) -> dict:
    print(f"Operation state: {path}", file=sys.stderr, flush=True)
    try:
        with OperationLock(path):
            state = read_operation(path, session.client.origin)
            if state["generationId"] is None:
                submit_operation(session, path, state)
            if args.no_wait:
                return operation_summary(path, state)
            deadline = session.clock() + args.wait_timeout
            previous_status = None
            while True:
                generation_id = urllib.parse.quote(state["generationId"], safe="")
                task = session.request(
                    "GET", f"/api/v1/generations/{generation_id}", account_id=state["accountId"],
                )
                if (
                    not isinstance(task, dict) or task.get("id") != state["generationId"]
                    or task.get("status") not in STATUSES
                ):
                    raise ProtocolError()
                state["status"] = task["status"]
                numeric_field(state, task, "costCredits")
                numeric_field(state, task, "progress")
                atomic_json(path, state)
                if state["status"] != previous_status:
                    print(state["status"], file=sys.stderr, flush=True)
                    previous_status = state["status"]
                if state["status"] == "SUCCEEDED":
                    download_images(session, path, state, task.get("images"))
                    return operation_summary(path, state)
                if state["status"] in ("FAILED", "CANCELED"):
                    raise CliError(f"Generation {state['status'].lower()}; no replacement job was submitted.")
                remaining = deadline - session.clock()
                if remaining <= 0:
                    raise CliError("The task is still running; resume the saved state later.")
                session.sleep(min(args.poll_interval, remaining))
    except (CliError, OSError, KeyboardInterrupt):
        print(f"Resume state: {path}", file=sys.stderr, flush=True)
        raise


def generate(session: Session, args: argparse.Namespace) -> dict:
    if not args.prompt.strip():
        raise CliError("The prompt must not be empty.")
    if args.n != 1:
        raise CliError("This CLI supports n=1 only.")
    references = local_references(args.reference)
    account = session.me()
    body = generation_body(args, live_models(session, account["id"]), len(references))
    output = Path(args.output_dir).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    if references:
        body["referenceImageKeys"] = [upload_reference(session, item, account["id"]) for item in references]
    operation_id = str(uuid.uuid4())
    path = session.store.directory / "operations" / f"{operation_id}.json"
    state = {
        "version": 1, "origin": session.client.origin, "operationId": operation_id,
        "accountId": account["id"], "requestBody": body,
        "requestSha256": hashlib.sha256(canonical_json(body)).hexdigest(),
        "generationId": None, "status": "PREPARED", "outputDir": str(output), "images": [],
    }
    # This durable, private record is the only source for every submission/replay.
    atomic_json(path, state)
    return run_operation(session, path, args)


def logout(client: ApiClient, store: CredentialStore) -> dict:
    revoked = False
    failed = False
    try:
        credential = store.load(client.origin)
        if credential is not None:
            try:
                response = client.request("POST", "/api/agent/revoke", token=credential["access_token"])
                if not isinstance(response, dict) or response.get("revoked") is not True:
                    raise ProtocolError()
                revoked = True
            except ApiError as error:
                if error.status != 401:
                    failed = True
            except CliError:
                failed = True
    finally:
        store.clear(client.origin)
    if failed:
        raise CliError("Local authorization was removed, but remote revocation was not confirmed.")
    return {"loggedOut": True, "revoked": revoked}


def positive_float(value: str) -> float:
    try:
        result = float(value)
        if positive_number(result):
            return result
    except ValueError:
        pass
    raise argparse.ArgumentTypeError("must be a finite number greater than zero")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)

    def common(target, child=False):
        defaults = argparse.SUPPRESS if child else None
        target.add_argument("--base-url", default=defaults if child else DEFAULT_BASE_URL, help="Production URL or HTTP loopback origin")
        target.add_argument("--no-browser", action="store_true", default=defaults if child else False, help="Print authorization link without opening a browser")
        target.add_argument("--client-name", default=defaults, help="Device name shown during authorization (default: hostname)")
        target.add_argument("--http-timeout", type=positive_float, default=defaults if child else 30, help="Per-request timeout in seconds")

    def polling(target):
        target.add_argument("--no-wait", action="store_true", help="Return the saved task without polling or downloading")
        target.add_argument("--wait-timeout", type=positive_float, default=600, help="Polling budget in seconds (default: 600)")
        target.add_argument("--poll-interval", type=positive_float, default=3, help="Seconds between task polls (default: 3)")

    common(result)
    commands = result.add_subparsers(dest="command", required=True)
    for name, help_text in (
        ("login", "Authorize this device in a browser"), ("models", "Show live capabilities and prices"),
        ("generate", "Submit an image request and save results"), ("resume", "Resume one saved operation"),
        ("logout", "Revoke authorization and clear the local credential"), ("status", "Show the authorized account"),
    ):
        command = commands.add_parser(name, help=help_text)
        common(command, child=True)
        if name == "generate":
            command.add_argument("--model", required=True, help="Exact ID from models")
            command.add_argument("--prompt", required=True)
            command.add_argument("--reference", action="append", default=[], metavar="PATH", help="Local image; repeat in the required reference order")
            command.add_argument("--size")
            command.add_argument("--quality")
            command.add_argument("--background")
            command.add_argument("--output-format")
            command.add_argument("--n", type=int, default=1, help="Image count (only 1 is supported)")
            command.add_argument("--output-dir", default="chugao-output")
            polling(command)
        elif name == "resume":
            command.add_argument("operation", help="Operation UUID or saved state path")
            polling(command)
    return result


def main(argv: list[str] | None = None) -> int:
    if sys.version_info < (3, 10):
        print("Error: Python 3.10 or newer is required.", file=sys.stderr)
        return 1
    args = parser().parse_args(argv)
    try:
        client = ApiClient(args.base_url, args.http_timeout)
        store = CredentialStore()
        if args.command == "logout":
            value = logout(client, store)
        else:
            session = Session(client, store, no_browser=args.no_browser, client_name=args.client_name)
            if args.command == "login":
                session.login()
                value = {"authorized": True, "origin": client.origin}
            elif args.command == "models":
                value = live_models(session)
            elif args.command == "status":
                account = session.me()
                value = {key: account.get(key) for key in ("id", "email", "credits", "expiresAt", "mode")}
            elif args.command == "generate":
                value = generate(session, args)
            else:
                value = run_operation(session, operation_path(store, args.operation), args)
        print(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except CliError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except OSError:
        print("Error: A local file operation failed; check paths and permissions.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted. Resume any saved operation instead of generating again.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
