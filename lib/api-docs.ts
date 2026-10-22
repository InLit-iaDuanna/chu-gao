/**
 * Editable API documentation, stored as Markdown in SystemConfig.
 *
 * Admins edit it at /admin/api-key-config. The line `{{models}}` is replaced
 * at render time by a live table of model IDs, parameters and API prices.
 */
import { db } from "@/lib/db";
import { MODELS_PLACEHOLDER } from "@/lib/api-docs-shared";

export { MAX_DOCS_LENGTH, MODELS_PLACEHOLDER } from "@/lib/api-docs-shared";

const KEY_DOCS = "apiDocs.markdown";

export const DEFAULT_API_DOCS_MARKDOWN = `# 出稿 API 接入文档

用 HTTP 直接调用出稿的生图能力。一次请求提交任务，同一个请求里拿回图片。

## 快速开始

1. 在「设置 → API 密钥」创建一个密钥（以 \`cgapi_\` 开头，只显示一次，请立即保存）。
2. 每个请求带上请求头 \`Authorization: Bearer cgapi_…\`。
3. 接口地址：\`https://chugao.art/api/v1\`

## 可用模型与价格

调用时 \`modelId\` 填下表中的 ID 即可。上游渠道和出图模式由平台自动调度，某个渠道失败会自动换其它渠道重试，调用方不需要关心。价格单位为积分/张，按实际出图的分辨率计费。

${MODELS_PLACEHOLDER}

## 生成图片

\`POST /generations\`

请求会一直等到出图完成（最长 180 秒），成功时直接在响应里返回 base64 图片。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| \`modelId\` | string | 是 | 模型 ID，见上表 |
| \`prompt\` | string | 是 | 提示词，最多 4000 字 |
| \`size\` | string | 否 | 输出尺寸，必须是该模型支持的值；不填用模型默认值 |
| \`quality\` | string | 否 | 质量档位，必须是该模型支持的值 |
| \`n\` | integer | 否 | 张数，默认 1，不超过该模型的 n 上限 |
| \`referenceImageKeys\` | string[] | 否 | 参考图，先用 \`POST /uploads\` 上传拿到 key |
| \`outputFormat\` | string | 否 | \`png\` / \`jpeg\` / \`webp\`，仅部分模型支持 |
| \`background\` | string | 否 | \`auto\` / \`opaque\` / \`transparent\`，仅部分模型支持 |
| \`outputCompression\` | integer | 否 | 0–100，仅 jpeg/webp 且模型支持时有效 |

可选请求头 \`Idempotency-Key\`：网络重试时带同一个值，不会重复出图和扣费。

可选查询参数 \`?wait=false\`：不等待，立即返回 202 和任务 ID，之后用 \`GET /generations/:id\` 取结果。

### 示例：Nano Banana 文生图

\`\`\`bash
curl -X POST "https://chugao.art/api/v1/generations" \\
  -H "Authorization: Bearer cgapi_your_key_here" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: demo-0001" \\
  -d '{
    "modelId": "nano-banana-2-512",
    "prompt": "一只戴墨镜的橘猫，坐在海边躺椅上，胶片质感",
    "size": "1024x1024",
    "n": 1
  }'
\`\`\`

成功（HTTP 200）：

\`\`\`json
{
  "ok": true,
  "data": {
    "id": "cmh3k2…",
    "modelId": "nano-banana-2-512",
    "status": "SUCCEEDED",
    "progress": 100,
    "costCredits": 2,
    "createdAt": "2026-10-23T08:00:00.000Z",
    "finishedAt": "2026-10-23T08:00:21.000Z",
    "errorCode": null,
    "errorMessage": null,
    "images": [
      { "b64_json": "iVBORw0KGgo…", "mimeType": "image/png", "width": 1024, "height": 1024 }
    ],
    "imagesExpired": false
  }
}
\`\`\`

失败时返回非 2xx（内容审核未通过为 400，其它失败为 502），积分已全额退回：

\`\`\`json
{
  "ok": false,
  "error": {
    "code": "GENERATION_FAILED",
    "message": "生成失败，积分将按实际结果结算，请查看积分流水",
    "details": { "id": "cmh3k2…", "status": "FAILED" }
  }
}
\`\`\`

### 示例：Nano Banana 参考图生图（Python）

\`\`\`python
import base64, requests

API_KEY  = "cgapi_your_key_here"
BASE_URL = "https://chugao.art/api/v1"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

# 1. 上传参考图（PNG / JPEG / WEBP，≤ 10MB）
with open("cat.png", "rb") as f:
    up = requests.post(f"{BASE_URL}/uploads", headers=HEADERS,
                       files={"file": ("cat.png", f, "image/png")})
up.raise_for_status()
ref_key = up.json()["data"]["key"]

# 2. 生成：请求会等到出图完成，最长 180 秒
resp = requests.post(f"{BASE_URL}/generations", headers=HEADERS, json={
    "modelId": "nano-banana-2-512",
    "prompt": "把这只猫画成水彩插画风格",
    "size": "1024x1024",
    "referenceImageKeys": [ref_key],
}, timeout=200)

data = resp.json()["data"] if resp.ok else None
if resp.status_code == 200:
    for i, img in enumerate(data["images"]):
        open(f"out_{i}.png", "wb").write(base64.b64decode(img["b64_json"]))
elif resp.status_code == 202:
    # 超过 180 秒还没出图：10 分钟内用任务 ID 取一次结果
    task = requests.get(f"{BASE_URL}/generations/{data['id']}", headers=HEADERS).json()["data"]
    print(task["status"])
else:
    print(resp.json()["error"])
\`\`\`

## 图片保存策略

- 生成的图片**不保存在服务器上**，只在响应里返回一次。请在收到后自行保存。
- 如果请求超时或网络中断，结果会在内存里暂留 10 分钟，用 \`GET /generations/:id\` 取一次，取走即删除；之后再查询只返回状态，\`images\` 为空且 \`imagesExpired\` 为 \`true\`。
- 上传的参考图会临时保存用于出图，按平台保留策略定期清理。

## 其它接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | \`/models\` | 模型列表、参数范围和 API 价格（\`prices\`，积分/张） |
| GET | \`/me\` | 账户积分余额 |
| GET | \`/generations/:id\` | 查询任务；成功且未取走时附带图片 |
| GET | \`/generations\` | 任务列表，支持 \`limit\`（≤100）、\`status\`、\`cursor\` 翻页，只返回状态不含图片 |
| POST | \`/uploads\` | 上传参考图（multipart，字段名 \`file\`） |

## 计费

- 提交时按预估价格冻结积分，出图成功后按实际张数和分辨率结算，多退少补。
- 失败、取消全额退回。

## 限制

- 并发上限按账户设置，超出返回 429。
- 每分钟提交次数有上限，超出返回 429，响应头 \`Retry-After\` 给出等待秒数。

## 错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| \`UNAUTHORIZED\` | 401 | 密钥无效、已撤销或已过期 |
| \`UNSUPPORTED_PARAM\` | 400 | 参数不被该模型支持（尺寸、质量、张数等） |
| \`MODERATION_REJECTED\` | 400 | 提示词或参考图未通过内容审核 |
| \`INSUFFICIENT_CREDITS\` | 402 | 积分不足 |
| \`IDEMPOTENCY_CONFLICT\` | 409 | 同一 Idempotency-Key 提交了不同参数 |
| \`RATE_LIMITED\` | 429 | 超出并发、每分钟或每日上限 |
| \`GENERATION_FAILED\` | 502 | 出图失败，积分已退回，可重试 |
| \`MODEL_NOT_AVAILABLE\` | 503 | 该模型暂无可用渠道，稍后重试 |
`;

export async function getApiDocsMarkdown(): Promise<{
  markdown: string;
  isDefault: boolean;
}> {
  if (process.env.DATABASE_URL) {
    try {
      const row = await db.systemConfig.findUnique({ where: { key: KEY_DOCS } });
      if (typeof row?.value === "string" && row.value.trim()) {
        return { markdown: row.value, isDefault: false };
      }
    } catch {
      /* fall back to the built-in docs */
    }
  }
  return { markdown: DEFAULT_API_DOCS_MARKDOWN, isDefault: true };
}

/** Save custom docs; an empty string restores the built-in default. */
export async function setApiDocsMarkdown(markdown: string): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  if (!markdown.trim()) {
    await db.systemConfig.deleteMany({ where: { key: KEY_DOCS } });
    return;
  }
  await db.systemConfig.upsert({
    where: { key: KEY_DOCS },
    create: { key: KEY_DOCS, value: markdown },
    update: { value: markdown },
  });
}
