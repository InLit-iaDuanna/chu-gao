---
name: chugao-image
description: Generate and save images with Chugao, using browser device authorization, live model capabilities, and optional ordered local reference images. Use for Chugao image requests and resuming its saved generation tasks.
---

# Chugao Image

Use the portable Python CLI in [scripts/chugao.py](scripts/chugao.py). It needs
Python 3.10+ and the standard library; a native `keyring` backend is optional.
The folder is a self-contained Agent Skill, with no host-specific tool dependency
or embedded credential. Run the script from the user's working/output directory,
not from the skill folder. In the examples, `SKILL_DIR` is this skill's absolute
folder path and `python3` must be Python 3.10 or newer.

## Generate

Inspect live models before choosing an exact model ID and supported parameters:

```bash
python3 "$SKILL_DIR/scripts/chugao.py" models
python3 "$SKILL_DIR/scripts/chugao.py" generate \
  --model MODEL_ID_FROM_MODELS \
  --prompt "A studio photograph of a red ceramic teapot" \
  --output-dir ./images
```

If authorization is missing or expired, the CLI prints a browser link and user
code and opens the link. Relay both to the user and let them authorize in their
browser; do not request passwords, cookies, or access tokens. For a remote or
headless environment, add `--no-browser`. The browser offers single-use or a
custom 1-hour to 30-day authorization; there is no CLI duration parameter.
`login` can also start this flow explicitly, and `--client-name` sets the device
name (otherwise the hostname is used).

Repeat `--reference` in the intended order. The CLI uploads the local files in
that order and preserves it in `referenceImageKeys`, including repeated files:

```bash
python3 "$SKILL_DIR/scripts/chugao.py" generate \
  --model MODEL_ID_FROM_MODELS \
  --prompt "Use the first image for composition and the second for color" \
  --reference ./composition.png --reference ./palette.jpg \
  --output-dir ./images
```

Use `--size`, `--quality`, `--background`, and `--output-format` only with values
from that model's current capabilities. Omitted values use its advertised
defaults, which are frozen into the saved request. The CLI validates the prompt,
reference count, model availability, and parameters before uploading/submitting.
It supports `n=1` only. Never silently switch models or change the user's reference
order. Model output includes the published cost table and pricing rules; the
server's accepted estimate and task cost are authoritative.

## Resume

Generation is asynchronous. By default the CLI polls and decodes `b64_json` into
local image files. Stdout contains a JSON summary with saved paths, never image
base64 or credentials. `--no-wait` returns after submission; `--wait-timeout`
(default 600 seconds) and `--poll-interval` (default 3 seconds) control task polling.

Before submitting, the CLI writes a private operation record under
`~/.config/chugao/operations/` and prints its path. It saves the UUID idempotency
key, account, exact final request including upload keys, and then the returned
generation ID. On interruption, timeout, failed download, or an unknown submit
outcome, use that operation instead of calling `generate` again:

```bash
python3 "$SKILL_DIR/scripts/chugao.py" resume OPERATION_UUID_OR_STATE_PATH
```

Resume polls the saved generation ID or replays the identical saved request and
idempotency key if the response was lost. It does not upload references again,
replace failed/canceled tasks, or issue a replacement generation. Keep the state
unchanged, retain the same origin, and authorize the original account if asked.
Already saved images are verified by hash; unrelated output files are not
overwritten.

## Authorization And Storage

```bash
python3 "$SKILL_DIR/scripts/chugao.py" status
python3 "$SKILL_DIR/scripts/chugao.py" logout
```

`status` reads the account, credits, expiry, and authorization mode. `logout`
attempts server revocation and clears the current origin's local credential even
if revocation cannot be confirmed; it does not delete operations or saved images.

Native keychains are preferred when an optional supported `keyring` backend is
available. Otherwise credentials go to `~/.config/chugao/credentials.json`
(directory `0700`, file `0600`). Operation files are also private and live outside
the skill. Do not put authorization caches into a distributed skill or print
their contents.

Production uses `https://chugao.art`. `--base-url` is only for an HTTP loopback
development server (`localhost`, `127.0.0.1`, or `[::1]`, with an optional port).
Credentials are isolated by exact origin, API redirects are never followed, and
proxy environment variables are ignored. For API schemas, recovery details, and
local-only verification, read [references/api.md](references/api.md).
