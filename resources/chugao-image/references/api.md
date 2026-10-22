# Chugao Agent API And CLI

## Transport

The production origin is `https://chugao.art`. The CLI accepts `--base-url` before
or after a subcommand, but overrides are limited to `http://localhost`,
`http://127.0.0.1`, and `http://[::1]`, with optional ports. A base URL cannot
contain user information, a non-root path, query, or fragment. Other hosts,
non-loopback HTTP, and alternative HTTPS origins are rejected.

Only relative `/api/` paths are requested. Credentials are loaded for and sent
only to the exact configured origin, including its scheme and effective port.
All HTTP redirects, including same-origin redirects, are rejected. No proxy
environment settings are used. TLS certificate validation remains enabled for
production. `--http-timeout` defaults to 30 seconds per request.

Device authorization and token responses are **raw OAuth JSON**, not envelopes.
All remaining API responses use:

```json
{"ok": true, "data": {}}
```

or:

```json
{"ok": false, "error": {"code": "ERROR_CODE", "message": "Description"}}
```

The CLI does not print raw error bodies or upstream messages, access/device
tokens, or image base64. Known API error codes use fixed local messages with
recovery guidance; unknown codes retain a generic HTTP-status error. Successful
commands print JSON to stdout; authorization links, user codes, progress, state
paths, and errors go to stderr. Exit codes are
`0` for a completed command (including `--no-wait`), `1` for an operational error,
`2` for invalid CLI syntax, and `130` for a keyboard interruption.

## Device Authorization

`POST /api/agent/device-authorization`, without a bearer token:

```text
Content-Type: application/x-www-form-urlencoded

client_id=chugao-skill&client_name=<hostname-or---client-name>
```

Raw response:

```json
{
  "device_code": "PRIVATE_DEVICE_CODE",
  "user_code": "ABCD-EFGH",
  "verification_uri": "https://chugao.art/app/agent/authorize",
  "verification_uri_complete": "https://chugao.art/app/agent/authorize?user_code=ABCD-EFGH",
  "expires_in": 600,
  "interval": 5
}
```

The CLI validates both verification URLs against the configured origin, prints
the complete link and user code, and opens the link unless `--no-browser` is set.
The user authorizes at `/app/agent/authorize?user_code=...`, choosing single-use
or a custom duration from 1 hour through 30 days. No client duration parameter,
embedded client secret, password collection, or browser cookie access is needed.

After the advertised interval, poll `POST /api/agent/token` without bearer auth:

```text
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=chugao-skill&device_code=<private-device-code>
```

Form fields are URL-encoded by the CLI. A successful raw response is:

```json
{
  "access_token": "PRIVATE_ACCESS_TOKEN",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "SERVER_DEFINED_SCOPE"
}
```

Raw OAuth errors use `{"error":"authorization_pending"}` (optionally with an
error description). The CLI handles:

| Error | Behavior |
| --- | --- |
| `authorization_pending` | Wait the current interval and poll again. |
| `slow_down` | Add 5 seconds to the interval for all subsequent polls. |
| `access_denied` | Stop without creating a generation. |
| `expired_token` / `invalid_grant` | Stop; a new login is needed. |

Polling also stops at the device authorization deadline. Token lifetime is cached
as an absolute expiry. There is no refresh-token endpoint in this contract.
`generate`, `models`, `status`, and authenticated resume requests authorize when
needed. A bearer `401`, or `403` with the exact code `SINGLE_TASK_USED`, allows one
reauthorization/retry of the original request with the same body and idempotency
key. This also handles a used single-use grant when uploading or reading another
task. Other `403` responses do not trigger reauthorization or automatic retries.
Failed generations never trigger a replacement submission. Login errors never
silently start another device flow inside the same command.

## Account And Models

The following endpoints require `Authorization: Bearer <access_token>`.

`GET /api/v1/me` returns envelope data:

```json
{"id":"USER_ID","email":"user@example.com","credits":100,"expiresAt":"SERVER_EXPIRY","mode":"SERVER_MODE"}
```

`status` prints these fields. The CLI also uses `id` to bind an operation to its
original account. Because server idempotency is namespaced by user, resuming
under another account is rejected before any generation POST.

`GET /api/v1/models` returns an array as envelope data. Each model exposes:

```text
id, displayName, available,
capabilities: {
  sizes, qualities, backgrounds, outputFormats, maxN,
  maxReferenceImages, supportsReferenceImage, ...
},
defaults: {size, quality, outputFormat, background},
costTable, pricingRules
```

The response contains no upstream connection details. `models` prints the public
fields as JSON. Model IDs and parameter values are not hardcoded. `generate`
requires an explicit `--model`, fetches fresh capabilities, checks availability,
and validates supported options before uploading. Missing defaults/options are
omitted rather than invented. If advertised, `maxPromptLength` is checked too.
An empty prompt, `n` other than 1, unsupported options, or excess/unsupported
references stop before generation submission. No fallback model is selected.

## Ordered Uploads And Submission

`POST /api/v1/uploads` uses `multipart/form-data` with one field named `file`.
The CLI requires readable, nonempty local files with recognized image extensions.
The server performs content validation. Envelope data is:

```json
{"key":"UPLOAD_KEY","mimeType":"image/png","width":1024,"height":1024,"sizeBytes":12345}
```

Repeated `--reference` flags are uploaded sequentially. Their returned keys are
kept in exactly the same order, including duplicates in the input list; references
are not sorted or deduplicated.

`POST /api/v1/generations` sends JSON and a UUID `Idempotency-Key` header:

```json
{
  "modelId": "EXACT_LIVE_MODEL_ID",
  "prompt": "Requested image",
  "size": "LIVE_SUPPORTED_SIZE",
  "quality": "LIVE_SUPPORTED_QUALITY",
  "background": "LIVE_SUPPORTED_BACKGROUND",
  "outputFormat": "LIVE_SUPPORTED_FORMAT",
  "n": 1,
  "referenceImageKeys": ["FIRST_UPLOAD_KEY", "SECOND_UPLOAD_KEY"]
}
```

Only `modelId`, `prompt`, and `n:1` are always sent. Optional values are explicit
CLI selections or advertised model defaults. `referenceImageKeys` is omitted for
text-only requests. The server namespaces idempotency keys by user.

A `202` response has envelope data:

```json
{"generationId":"GENERATION_ID","status":"PENDING","estimatedCredits":10}
```

After all uploads and before the first generation POST, the CLI durably saves
`~/.config/chugao/operations/<operation-uuid>.json` with these fields:

```text
version, origin, operationId, accountId,
requestBody, requestSha256,
generationId: null, status: PREPARED, outputDir, images: []
```

The operation UUID is the idempotency key. The finalized request body includes
the ordered upload keys and resolved defaults. A request hash detects accidental
edits. Credentials are never stored in operation records. After acceptance, the
generation ID, status, and estimated cost are saved before polling.

On a connection failure, lost/malformed submit response, or ambiguous `5xx`/`408`,
the CLI reports an unknown submission outcome and the state path. It does not
retry with a new key. Use `resume <operation-uuid-or-state-path>` to replay the
same canonical JSON bytes and UUID; the server returns the original operation.
Resume does not depend on the original local reference files or re-upload them.
If a generation ID is already saved, resume never submits again. It also does not
refetch defaults or change an existing request when the model list changes.

## Tasks And Image Downloads

`GET /api/v1/generations/{id}` returns envelope data:

```text
id, modelId, status, progress, costCredits, errorCode, errorMessage,
images: [{id, width, height, mimeType}]
```

Statuses are `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, and `CANCELED`.
The CLI polls pending/running tasks, saves status/cost/progress, and stops on
success or failure. A failed/canceled task never causes a replacement POST.
`--no-wait` returns the saved task without polling/downloading. Polling timeout
does not cancel the remote task; the saved state remains resumable. HTTP request
and authorization timeouts are separate from the task polling budget.

For each successful image, request
`GET /api/v1/generations/{id}/images/{imageId}` with its default behavior (no
response-format override). Envelope data is:

```json
{"b64_json":"BASE64_IMAGE_BYTES","mimeType":"image/png","width":1024,"height":1024}
```

The CLI validates base64, rejects empty data/unsupported MIME types, and saves
binary files in `--output-dir` (default `./chugao-output`). PNG, JPEG, WebP, GIF,
AVIF, TIFF, and BMP MIME types map to local extensions. Output names use the
operation UUID and image index, not arbitrary server filenames. Existing identical
files can be reused; unrelated files are not overwritten. Saved paths and SHA-256
hashes are cached per image so interrupted downloads can resume. Base64 is never
printed or saved in state. The final stdout summary includes operation ID,
generation ID, status, state path, image paths, and known costs.

Operation records are `0600` in a `0700` directory. An OS lock prevents concurrent
processes from updating the same record. Small `.lock` files remain in the cache;
the OS releases locks on process exit, including crashes. Resume accepts a UUID
or a file in the same user's operation cache, not an arbitrary imported request.

## Logout And Credential Storage

`POST /api/agent/revoke`, with bearer auth, returns
`{"ok":true,"data":{"revoked":true}}`. `logout` uses the cached token without
opening an authorization browser. It clears the current origin's local credential
even on a failed revocation, reports unconfirmed revocation as an error, and treats
`401` as an already invalid authorization. Other origins' credentials, saved
operations, and downloaded images are preserved.

The optional `keyring` package is used only with supported native keychain
backends (macOS, Windows, Secret Service, KWallet, libsecret). If unavailable or a
write fails, the fallback is `~/.config/chugao/credentials.json`, with directory
mode `0700` and file mode `0600` on POSIX. Entries are keyed by normalized origin
and contain `access_token`, `token_type`, `expires_at`, and `scope` under
`{"version":1,"credentials":{...}}`. A fallback entry takes precedence over a
stale keychain entry; a successful keychain write removes that origin's fallback.
Never distribute these files with the skill. Single-use browser grants may be
consumed by the service; a subsequent `401` or `403` / `SINGLE_TASK_USED` requires
browser authorization again.

---

## API Key Authentication

In addition to the device-authorization (`cg_` prefix) bearer tokens used by the
CLI, the v1 API also accepts **API keys** (`cgapi_` prefix) created from the
Settings page.  API keys are suitable for server-side integrations and automated
pipelines that do not require browser-based authorization.

### Creating a key

Sign in to [chugao.art](https://chugao.art), open **Settings → API 密钥**, and
click **新建密钥**.  Give the key a human-readable name.  The full key value is
shown **only once** immediately after creation — copy it and store it securely.

### Using a key

Pass the key as a standard Bearer token:

```http
Authorization: Bearer cgapi_<your-key>
```

All endpoints under `/api/v1/` accept both `cg_` and `cgapi_` tokens
interchangeably.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/me` | Return caller identity and remaining credits |
| `POST` | `/api/v1/generations` | Submit an image-generation job |
| `GET`  | `/api/v1/generations/:id` | Poll job status |
| `GET`  | `/api/v1/generations/:id/images/:imageId` | Download a completed image (base64) |
| `POST` | `/api/v1/uploads` | Upload a reference image |
| `GET`  | `/api/v1/keys` | List your active API keys |
| `POST` | `/api/v1/keys` | Create a new API key |
| `DELETE` | `/api/v1/keys/:id` | Revoke an API key |

### `POST /api/v1/generations`

Request body (JSON):

```json
{
  "modelId": "nano-banana-2",
  "prompt": "a futuristic cityscape at sunset",
  "size": "1024x1024",
  "n": 1
}
```

Successful response (`202 Accepted`):

```json
{
  "ok": true,
  "data": {
    "id": "gen_xxxxxxxx",
    "status": "PENDING",
    "modelId": "nano-banana-2",
    "createdAt": "2026-10-22T00:00:00.000Z"
  }
}
```

Poll `GET /api/v1/generations/:id` until `status` is `DONE` or `FAILED`.

### `GET /api/v1/generations/:id`

```json
{
  "ok": true,
  "data": {
    "id": "gen_xxxxxxxx",
    "status": "DONE",
    "images": [{ "id": "img_yyyyyyyy" }]
  }
}
```

### `GET /api/v1/generations/:id/images/:imageId`

Returns the rendered image as a base64 payload:

```json
{
  "ok": true,
  "data": {
    "b64_json": "<base64>",
    "mimeType": "image/png",
    "width": 1024,
    "height": 1024
  }
}
```

### Concurrency

Each account has a configurable `concurrentLimit` (default 10 for API key
callers).  Submit jobs in parallel up to that limit; additional submissions are
queued automatically by the BullMQ worker.  There is no client-side throttle
needed — the server serializes excess requests with a per-user advisory lock.

### Rate limits

API keys share the same Redis sliding-window rate limiter as agent tokens.
A `429` response includes a `Retry-After` header (seconds).  Back off
exponentially starting from that value.

### Error codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `KEY_REVOKED` | 401 | Key has been revoked |
| `KEY_EXPIRED` | 401 | Key has passed its expiry date |
| `LIMIT_EXCEEDED` | 400 | Per-user key limit (10) reached |
| `INSUFFICIENT_CREDITS` | 402 | Account has no remaining credits |
| `PROVIDER_UNAVAILABLE` | 503 | All upstream image providers are down |
| `CONTENT_REJECTED` | 422 | Prompt or image rejected by content policy |

---

## Local Verification

From the repository root, using Python 3.10+:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s resources/chugao-image/tests -v
```

Tests use only local mocked HTTP servers and temporary homes/output files under
the test directory. They make no production or paid API calls and clean up those
temporary files. They exercise authorization polling/errors, ordered uploads,
live validation, interrupted submit replay, saved-task reauthorization, local
base64 output, credential permissions, origin isolation, redirects, and logout.
