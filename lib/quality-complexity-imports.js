"use strict";

function isWordAt(text, index, word) {
  return text.startsWith(word, index) && !/[\w$]/.test(text[index - 1] || "") && !/[\w$]/.test(text[index + word.length] || "");
}

function skipString(text, index) {
  const quote = text[index];
  let cursor = index + 1;
  while (cursor < text.length) {
    if (text[cursor] === "\\") cursor += 2;
    else if (text[cursor] === quote) return cursor + 1;
    else cursor += 1;
  }
  return cursor;
}

function parseStringArg(text, index) {
  let cursor = index;
  while (/\s/.test(text[cursor] || "")) cursor += 1;
  if (!["\"", "'"].includes(text[cursor])) return null;
  const quote = text[cursor];
  let end = cursor + 1;
  while (end < text.length) {
    if (text[end] === "\\") end += 2;
    else if (text[end] === quote) return { value: text.slice(cursor + 1, end), end: end + 1 };
    else end += 1;
  }
  return null;
}

function segmentUntil(text, index) {
  const end = text.slice(index).search(/[;\n]/);
  return end === -1 ? text.slice(index) : text.slice(index, index + end);
}

function scanImports(text) {
  const imports = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("//", index)) {
      const next = text.indexOf("\n", index + 2);
      index = next === -1 ? text.length : next + 1;
    } else if (text.startsWith("/*", index)) {
      const next = text.indexOf("*/", index + 2);
      index = next === -1 ? text.length : next + 2;
    } else if (["\"", "'", "`"].includes(text[index])) {
      index = skipString(text, index);
    } else if (isWordAt(text, index, "require")) {
      let cursor = index + "require".length;
      let type = "require";
      if (text.startsWith(".resolve", cursor)) {
        cursor += ".resolve".length;
        type = "require.resolve";
      }
      while (/\s/.test(text[cursor] || "")) cursor += 1;
      const parsed = text[cursor] === "(" ? parseStringArg(text, cursor + 1) : null;
      if (parsed) imports.push({ type, specifier: parsed.value });
      index = parsed?.end || cursor + 1;
    } else if (isWordAt(text, index, "import")) {
      let cursor = index + "import".length;
      while (/\s/.test(text[cursor] || "")) cursor += 1;
      if (text[cursor] === "(") {
        const parsed = parseStringArg(text, cursor + 1);
        imports.push(parsed ? { type: "dynamic import", specifier: parsed.value } : { type: "dynamic import", dynamic: true });
        index = parsed?.end || cursor + 1;
      } else {
        const segment = segmentUntil(text, index);
        const sideEffect = segment.match(/^\s*import\s+["']([^"']+)["']/);
        const from = segment.match(/\bfrom\s+["']([^"']+)["']/);
        if (sideEffect || from) imports.push({ type: "static import", specifier: (sideEffect || from)[1] });
        index += Math.max(segment.length, 1);
      }
    } else if (isWordAt(text, index, "export")) {
      const segment = segmentUntil(text, index);
      const from = segment.match(/\bfrom\s+["']([^"']+)["']/);
      if (from) imports.push({ type: "export from", specifier: from[1] });
      index += Math.max(segment.length, 1);
    } else {
      index += 1;
    }
  }
  return imports;
}

module.exports = { scanImports };
