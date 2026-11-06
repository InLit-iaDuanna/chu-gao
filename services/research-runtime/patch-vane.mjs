import fs from "node:fs";
import { createRequire } from "node:module";

function replace(file, from, to) {
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes(from))
    throw Error(`Pinned Vane source changed: ${file}`);
  fs.writeFileSync(file, source.replace(from, to));
}

fs.writeFileSync(
  "src/lib/chugao.ts",
  `import { AsyncLocalStorage } from 'node:async_hooks';
const state = globalThis as any;
export const researchContext: AsyncLocalStorage<{ gateway: string; token: string }> = state.__chugaoContext ??= new AsyncLocalStorage();
const nativeFetch = globalThis.fetch.bind(globalThis);
if (!state.__chugaoFetchInstalled) {
  state.__chugaoFetchInstalled = true;
  globalThis.fetch = (async (resource: any, init?: any) => {
    const context = researchContext.getStore();
    const url = typeof resource === 'string' ? resource : resource.url || resource.toString();
    if (!context || url.startsWith(context.gateway) || !/^https?:/.test(url)) return nativeFetch(resource, init);
    const response = await nativeFetch(context.gateway + '/crawl', { method: 'POST', headers: { Authorization: 'Bearer ' + context.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ url, screenshot: true }), signal: init?.signal });
    if (!response.ok) throw Error('Chugao capture failed: ' + response.status);
    const page = await response.json();
    return new Response(page.html || page.markdown || '', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;
}
`,
);

replace(
  "src/app/api/search/route.ts",
  "export const POST = async (req: Request) => {",
  "const runSearch = async (req: Request) => {",
);
replace(
  "src/app/api/search/route.ts",
  "messageId: crypto.randomUUID(),\n    });",
  "messageId: crypto.randomUUID(),\n    }).catch((error: unknown) => session.emit('error', { message: error instanceof Error ? error.message : 'Research failed' }));",
);
fs.appendFileSync(
  "src/app/api/search/route.ts",
  `\nimport { researchContext } from '@/lib/chugao';
export const POST = async (req: Request) => {
  const input = await req.clone().json();
  if (!input._chugao?.gateway || !input._chugao?.token) return Response.json({ message: 'Chugao task context required' }, { status: 403 });
  return researchContext.run({ gateway: input._chugao.gateway, token: input._chugao.token }, () => runSearch(req));
};\n`,
);
replace(
  "src/lib/searxng.ts",
  "import { getSearxngURL } from './config/serverRegistry';",
  "import { researchContext } from './chugao';",
);
replace(
  "src/lib/searxng.ts",
  "const searxngURL = getSearxngURL();",
  "const context = researchContext.getStore(); if (!context) throw Error('Missing Chugao task context'); const searxngURL = context.gateway + '/searx';",
);
replace(
  "src/lib/searxng.ts",
  "signal: controller.signal,",
  "signal: controller.signal, headers: { Authorization: 'Bearer ' + context.token },",
);
replace(
  "src/lib/searxng.ts",
  "setTimeout(() => controller.abort(), 10000)",
  "setTimeout(() => controller.abort(), 45000)",
);
replace(
  "src/lib/models/providers/openai/openaiLLM.ts",
  "apiKey: this.config.apiKey,",
  "apiKey: this.config.apiKey, maxRetries: 0,",
);
replace(
  "src/lib/models/providers/openai/openaiEmbedding.ts",
  "input: texts,",
  "input: texts.map((text) => 'query: ' + text),",
);
replace(
  "src/lib/models/providers/openai/openaiEmbedding.ts",
  "input: chunks.map((c) => c.content),",
  "input: chunks.map((c) => 'passage: ' + c.content),",
);

// Optional third-party widgets are outside the self-hosted research contract.
const ts = createRequire(process.cwd() + "/package.json")("typescript");
const agentFile = "src/lib/agents/search/api.ts";
const source = fs.readFileSync(agentFile, "utf8");
const ast = ts.createSourceFile(
  agentFile,
  source,
  ts.ScriptTarget.Latest,
  true,
);
let initializer;
function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.initializer?.getText(ast).includes(".executeAll(")
  ) {
    if (initializer) throw Error("Ambiguous Vane widget initializer");
    initializer = node.initializer;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (!initializer) throw Error("Pinned Vane widget contract changed");
fs.writeFileSync(
  agentFile,
  source.slice(0, initializer.getStart(ast)) +
    "(false ? " +
    initializer.getText(ast) +
    " : Promise.resolve([]))" +
    source.slice(initializer.end),
);
