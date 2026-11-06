# ComfyArt Canvas Integration

Upstream: https://github.com/jtydhr88/ComfyArt
Pinned revision: aad271e6d14560eadfe9f2d8e04ded38042da9f9
Local upstream checkout: downloads/ComfyArt (excluded from app builds and Git).

The canvas uses tldraw 5.5.2, the same pinned SDK as this upstream revision.
The ArtboardShape, DoodleShape and CommentShape implementations in vendor/
come from ComfyArt under its MIT license. Local changes adapt translations,
icons and styles. Preserve vendor/LICENSE and vendor/tldraw-LICENSE.md.

The integration uses Chugao authentication, uploads, generation queue,
pricing, quality settings and private image endpoints. It does not start
ComfyUI or download local inference models. ComfyUI-specific video, 3D,
OCR and local-model workflows are not presented as available tools.

Documents and pages persist in IndexedDB under the authenticated user ID.
Pending image tasks are recorded in the document and reconnect on mount.
Completion uses stable shape IDs to avoid inserting an image twice.
Images are uploaded to the existing private storage. JSON backups include
the document; access to private images still requires the owning account.
The old node canvas and its localStorage documents remain at /app/nodes.

All SDK UI assets are self-hosted. Run pnpm canvas:assets to refresh them.
Production requires a valid tldraw license key in TLDRAW_LICENSE_KEY.
The server reads it at runtime, so Docker deployments can use the existing .env
file and restart web without rebuilding to enable the canvas. The public
NEXT_PUBLIC_TLDRAW_LICENSE_KEY build-time variable is also accepted.
Without a key, the production canvas route retains the old node canvas.
Local development uses the ComfyArt canvas with tldraw's development notice.

For a database-free local UI review, start development with
CANVAS_PREVIEW_ENABLED=1 and open /ui-review/canvas. This route is disabled in
production and does not bypass authentication for generation or uploads.

Storage measured locally: full upstream checkout 64 MB, generated SDK public
assets 4.2 MB, SDK package directories about 40 MB before transitive packages.
The complete site's standalone runtime is about 173 MB, excluding Docker base
layers, databases and user images. Build caches are additional (about 639 MB in
the isolated verification build). No local inference weights are installed.

Verified locally: production build, TypeScript, scoped ESLint and 13 focused
tests. Desktop/mobile UI checks covered multiple pages, refresh persistence,
sketch visibility, PNG export with visible strokes and Image2.5 quality choices.
No paid image-generation requests were made during these checks.
