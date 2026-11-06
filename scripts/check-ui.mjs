import { readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { readdir } from "node:fs/promises";

const roots = ["app", "components", "styles"];
const ignoredRoots = ["components/admin", "components/workbench"];
const allowedDynamicStyleFiles = new Set([
  "app/page.tsx",
  "components/auth/AuthShell.tsx",
  "components/canvas/DesignStudio.tsx",
  "components/canvas/InfiniteCanvas.tsx",
  "components/canvas/InfiniteCanvasNodes.tsx",
  "components/canvas/infinite-canvas-model.ts",
  "components/studio/SettingsView.tsx",
  "components/studio/GenerationCard.tsx",
  "components/studio/GenerationWall.tsx",
  "components/studio/dock/DockWorkspace.tsx",
  "components/studio/nodes/NodeCanvas.tsx",
  "components/studio/nodes/node-bodies.tsx",
  "components/studio/panels/QueuePanel.tsx",
  "components/studio/ppt/PptStudio.tsx",
]);

const studioInteractiveTags = new Set([
  "Button",
  "button",
  "IconButton",
  "a",
  "Link",
  "DropdownMenuItem",
  "TabsTrigger",
  "SelectTrigger",
]);
const studioRoot = "components/studio";

const failures = [];
const failureKeys = new Set();

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function report(path, source, index, code, message) {
  const line = lineNumber(source, index);
  const key = `${path}:${line}:${code}:${message}`;
  if (failureKeys.has(key)) return;
  failureKeys.add(key);
  failures.push(`${path}:${line}: [${code}] ${message}`);
}

function findBalancedEnd(source, start, open = "{", close = "}") {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function findJsxTagEnd(source, start) {
  let braceDepth = 0;
  let quote = null;
  let escaped = false;

  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (char === ">" && braceDepth === 0) return index;
  }

  return -1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readJsxAttribute(opening, name) {
  const pattern = new RegExp(
    `(?:^|\\s)${escapeRegExp(name)}(?=\\s*=|\\s|/?>)`,
    "g",
  );
  const match = pattern.exec(opening);
  if (!match) return null;

  let cursor = match.index + match[0].length;
  while (/\s/.test(opening[cursor] ?? "")) cursor += 1;
  if (opening[cursor] !== "=") {
    return { value: null, index: match.index + match[0].lastIndexOf(name) };
  }

  cursor += 1;
  while (/\s/.test(opening[cursor] ?? "")) cursor += 1;
  const valueStart = cursor;
  const first = opening[cursor];

  if (first === '"' || first === "'" || first === "`") {
    cursor += 1;
    let escaped = false;
    while (cursor < opening.length) {
      const char = opening[cursor];
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === first) break;
      cursor += 1;
    }
    return {
      value: opening.slice(valueStart + 1, cursor),
      index: match.index + match[0].lastIndexOf(name),
    };
  }

  if (first === "{") {
    const end = findBalancedEnd(opening, cursor);
    return {
      value:
        end === -1 ? opening.slice(cursor + 1) : opening.slice(cursor + 1, end),
      index: match.index + match[0].lastIndexOf(name),
    };
  }

  while (cursor < opening.length && !/[\s>]/.test(opening[cursor])) {
    cursor += 1;
  }
  return {
    value: opening.slice(valueStart, cursor),
    index: match.index + match[0].lastIndexOf(name),
  };
}

function hasJsxAttribute(opening, name) {
  return readJsxAttribute(opening, name) !== null;
}

function collectStringConstants(source) {
  const constants = new Map();
  const pattern =
    /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])([\s\S]*?)\2/g;
  let match;
  while ((match = pattern.exec(source))) {
    if (!match[3].includes("${")) constants.set(match[1], match[3]);
  }
  return constants;
}

function expandClassValue(value, constants) {
  let expanded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = expanded.replace(
      /\b[A-Za-z_$][\w$]*\b/g,
      (identifier) => constants.get(identifier) ?? identifier,
    );
    if (next === expanded) break;
    expanded = next;
  }
  return expanded;
}

function classValueFor(opening, constants) {
  const attribute = readJsxAttribute(opening, "className");
  if (!attribute?.value) return null;
  return expandClassValue(attribute.value, constants);
}

function findOpacityTokens(classValue) {
  const tokens = [];
  const pattern = /((?:[A-Za-z0-9_-]+:)*)opacity-(\d{1,3})\b/g;
  let match;
  while ((match = pattern.exec(classValue))) {
    tokens.push({
      value: Number(match[2]),
      variants: match[1] ? match[1].split(":").filter(Boolean) : [],
      text: `${match[1]}opacity-${match[2]}`,
      index: match.index,
    });
  }
  return tokens;
}

function hasVisibleFaintToken(classValue) {
  const pattern = /((?:[A-Za-z0-9_-]+:)*)text-text-faint\b/g;
  let match;
  while ((match = pattern.exec(classValue))) {
    const variants = match[1] ? match[1].split(":").filter(Boolean) : [];
    if (!variants.includes("placeholder")) return true;
  }
  return false;
}

function hasHoverReveal(classValue) {
  return /(?:[A-Za-z0-9_-]+:)*(?:group-)?(?:hover|focus-within):opacity-100\b/.test(
    classValue,
  );
}

function scanJsxElements(source) {
  const elements = [];
  const pattern = /<([A-Za-z][A-Za-z0-9]*)\b/g;
  let match;

  while ((match = pattern.exec(source))) {
    const name = match[1];
    if (
      !studioInteractiveTags.has(name) &&
      !["label", "div", "span"].includes(name)
    ) {
      continue;
    }

    const start = match.index;
    const end = findJsxTagEnd(source, start);
    if (end === -1) continue;

    const opening = source.slice(start, end + 1);
    const selfClosing = /\/\s*>$/.test(opening);
    let closeStart = -1;
    let closeEnd = end;
    let body = "";

    if (!selfClosing) {
      let depth = 1;
      const tagPattern = new RegExp(`<\\/?${name}(?=[\\s/>])`, "g");
      tagPattern.lastIndex = end + 1;
      let tagMatch;
      while ((tagMatch = tagPattern.exec(source))) {
        const tagEnd = findJsxTagEnd(source, tagMatch.index);
        if (tagEnd === -1) break;
        const tag = source.slice(tagMatch.index, tagEnd + 1);
        if (tag.startsWith(`</${name}`)) {
          depth -= 1;
          if (depth === 0) {
            closeStart = tagMatch.index;
            closeEnd = tagEnd;
            body = source.slice(end + 1, closeStart);
            break;
          }
        } else if (!/\/\s*>$/.test(tag)) {
          depth += 1;
        }
        tagPattern.lastIndex = tagEnd + 1;
      }
    }

    const label = readJsxAttribute(opening, "aria-label");
    const title = readJsxAttribute(opening, "title");
    const role = readJsxAttribute(opening, "role");
    const tabIndex = readJsxAttribute(opening, "tabIndex");
    const className = readJsxAttribute(opening, "className");

    if ((name === "div" || name === "span") && role?.value !== "button") {
      continue;
    }

    if (
      name === "label" &&
      !className?.value?.includes("cursor-pointer") &&
      !source.slice(end + 1, closeEnd + 1).includes('type="file"') &&
      !source.slice(end + 1, closeEnd + 1).includes("type='file'")
    ) {
      continue;
    }

    elements.push({
      name,
      start,
      end,
      opening,
      body,
      selfClosing,
      closeStart,
      closeEnd,
      label,
      title,
      role,
      tabIndex,
      className,
    });
  }

  return elements;
}

function collectBodyParts(body) {
  const text = [];
  const expressions = [];
  const tags = [];
  let hasMarkup = false;

  for (let index = 0; index < body.length; ) {
    if (body[index] === "<") {
      const tagEnd = findJsxTagEnd(body, index);
      if (tagEnd !== -1) {
        const tag = body.slice(index, tagEnd + 1);
        const tagName = tag.match(/^<\/?\s*([A-Za-z][A-Za-z0-9.]*)/);
        if (tagName) tags.push(tagName[1]);
        hasMarkup = true;
        index = tagEnd + 1;
        continue;
      }
    }
    if (body[index] === "{") {
      const expressionEnd = findBalancedEnd(body, index);
      if (expressionEnd !== -1) {
        expressions.push(body.slice(index + 1, expressionEnd));
        hasMarkup = true;
        index = expressionEnd + 1;
        continue;
      }
    }
    text.push(body[index]);
    index += 1;
  }

  return { text: text.join(""), expressions, tags, hasMarkup };
}

function isIconOnlyBody(body) {
  if (!body.trim()) return false;
  const { text, expressions, tags, hasMarkup } = collectBodyParts(body);
  if (!hasMarkup || text.trim()) return false;

  const iconTags = tags.every(
    (tag) => tag === "svg" || tag.startsWith("svg.") || /^[A-Z]/.test(tag),
  );
  if (!iconTags) return false;

  for (const expression of expressions) {
    const cleaned = expression
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .trim();
    if (!cleaned) continue;
    if (/^["'`]\s*["'`]$/.test(cleaned)) continue;
    if (/<[A-Za-z]/.test(cleaned) && !/["'`]\s*[^"'`]\S/.test(cleaned)) {
      continue;
    }
    if (
      /\b(?:children|label|title|text|name|displayName|description|value)\b/.test(
        cleaned,
      )
    ) {
      return false;
    }
    if (
      /\b(?:Icon|Spinner|Arrow|Check|X|Plus|Minus|Close|Menu)\b/.test(cleaned)
    ) {
      continue;
    }
    return false;
  }

  return true;
}

function hasSquareControlClass(classValue) {
  if (!classValue) return false;
  const hasWidth = /(?:^|\s)(?:w|size)-(?:\d+|\[[^\]]+\])\b/.test(classValue);
  const hasHeight = /(?:^|\s)(?:h|size)-(?:\d+|\[[^\]]+\])\b/.test(classValue);
  return (
    (hasWidth && hasHeight) ||
    /(?:^|\s)(?:p-0|aspect-square)\b/.test(classValue)
  );
}

function isInteractiveElement(element) {
  if (studioInteractiveTags.has(element.name)) return true;
  if (element.name === "label") return true;
  return (
    (element.name === "div" || element.name === "span") &&
    element.role?.value === "button"
  );
}

function checkStudioElement(path, source, element, constants) {
  if (!isInteractiveElement(element)) return;

  const classValue = classValueFor(element.opening, constants) ?? "";
  const opacityTokens = findOpacityTokens(classValue);
  const faint = hasVisibleFaintToken(classValue);
  const reducedOpacity = opacityTokens.filter((token) => token.value < 100);

  if (
    faint &&
    reducedOpacity.length > 0 &&
    !(
      reducedOpacity.every((token) => token.value === 0) &&
      hasHoverReveal(classValue)
    )
  ) {
    const opacityText = reducedOpacity.map((token) => token.text).join(", ");
    report(
      path,
      source,
      element.className?.index != null
        ? element.start + element.className.index
        : element.start,
      "studio-faint-opacity",
      `interactive ${element.name} combines text-text-faint with ${opacityText}; use a readable icon token and explicit disabled styling`,
    );
  }

  const disabledOpacity = opacityTokens.filter(
    (token) => token.variants.includes("disabled") && token.value < 50,
  );
  const conditionalDisabledOpacity =
    hasJsxAttribute(element.opening, "disabled") &&
    classValue.includes("cursor-not-allowed")
      ? opacityTokens.filter(
          (token) =>
            token.variants.length === 0 && token.value > 0 && token.value < 50,
        )
      : [];
  const lowDisabledOpacity = [
    ...disabledOpacity,
    ...conditionalDisabledOpacity,
  ];

  if (lowDisabledOpacity.length > 0) {
    const opacityText = [
      ...new Set(lowDisabledOpacity.map((token) => token.text)),
    ].join(", ");
    report(
      path,
      source,
      element.className?.index != null
        ? element.start + element.className.index
        : element.start,
      "studio-disabled-opacity",
      `interactive ${element.name} uses very low disabled opacity (${opacityText}); keep disabled controls visually identifiable`,
    );
  }

  if (
    element.name === "Button" &&
    !hasJsxAttribute(element.opening, "asChild") &&
    isIconOnlyBody(element.body) &&
    (hasJsxAttribute(element.opening, "aria-label") ||
      hasJsxAttribute(element.opening, "title") ||
      hasSquareControlClass(classValue))
  ) {
    report(
      path,
      source,
      element.start,
      "studio-icon-button",
      "likely icon-only Button should use IconButton to inherit consistent icon sizing and states",
    );
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

for (const root of roots) {
  for (const file of await walk(root)) {
    const path = relative(process.cwd(), file);
    if (
      ignoredRoots.some(
        (ignored) => path === ignored || path.startsWith(`${ignored}/`),
      )
    )
      continue;
    if (![".css", ".ts", ".tsx"].includes(extname(path))) continue;

    const source = readFileSync(file, "utf8");
    const deprecatedBrutal = /\b(?:button|card)-brutal\b/.exec(source);
    if (deprecatedBrutal) {
      report(
        path,
        source,
        deprecatedBrutal.index,
        "style",
        "deprecated brutal style",
      );
    }
    const heavyShadow = /\b(?:shadow-2xl|drop-shadow)\b/.exec(source);
    if (heavyShadow) {
      report(
        path,
        source,
        heavyShadow.index,
        "style",
        "disallowed heavy shadow",
      );
    }
    const oversizedRadius = /rounded-\[(?:1[7-9]|[2-9]\d)px\]/.exec(source);
    if (oversizedRadius) {
      report(
        path,
        source,
        oversizedRadius.index,
        "style",
        "radius exceeds 16px",
      );
    }
    const inlineStyle = /style=\{\{/.exec(source);
    if (inlineStyle && !allowedDynamicStyleFiles.has(path)) {
      report(
        path,
        source,
        inlineStyle.index,
        "style",
        "inline style is not an approved dynamic-style exception",
      );
    }

    if (path === studioRoot || path.startsWith(`${studioRoot}/`)) {
      const constants = collectStringConstants(source);
      for (const element of scanJsxElements(source)) {
        checkStudioElement(path, source, element, constants);
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("UI conventions check passed.");
