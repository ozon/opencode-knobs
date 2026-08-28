import { modify, applyEdits as jsoncApplyEdits, parseTree, type JSONPath } from "jsonc-parser";

export function detectIndent(raw: string): { insertSpaces: boolean; tabSize: number } {
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\s+)\S/);
    if (m) {
      if (m[1].includes("\t")) return { insertSpaces: false, tabSize: 1 };
      return { insertSpaces: true, tabSize: m[1].length };
    }
  }
  return { insertSpaces: true, tabSize: 2 };
}

function removeProperty(text: string, path: (string | number)[]): string {
  const root = parseTree(text);
  if (!root) return text;

  let node: any = root;
  for (let i = 0; i < path.length - 1; i++) {
    if (!node?.children) return text;
    const prop = node.children.find(
      (c: any) => c.type === "property" && c.children?.[0]?.value === path[i]
    );
    if (!prop) return text;
    node = prop.children[1];
  }

  if (!node?.children) return text;
  const lastKey = path[path.length - 1];
  const propIdx = node.children.findIndex(
    (c: any) => c.type === "property" && c.children?.[0]?.value === lastKey
  );
  if (propIdx === -1) return text;
  const propNode = node.children[propIdx];
  const valNode = propNode.children?.[1];
  if (!valNode) return text;

  let end = valNode.offset + valNode.length;
  while (end < text.length && text[end] === ",") end++;
  while (end < text.length && (text[end] === "\n" || text[end] === "\r")) end++;

  let lineStart = propNode.offset;
  while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--;

  return text.slice(0, lineStart) + text.slice(end);
}

export function applyPatch(raw: string, path: (string | number)[], value: unknown): string {
  const text = raw.trim() === "" ? "{}" : raw;
  if (value === undefined) return removeProperty(text, path);
  const opts = detectIndent(text);
  const edits = modify(text, path as JSONPath, value, { formattingOptions: opts });
  return jsoncApplyEdits(text, edits);
}

function getNodeKey(tree: any, segments: string[]): any {
  let node = tree;
  for (let i = 0; i < segments.length; i++) {
    if (!node?.children) return null;
    const prop = node.children.find(
      (c: any) => c.type === "property" && c.children?.[0]?.value === segments[i]
    );
    if (!prop) return null;
    if (i === segments.length - 1) return prop.children[0];
    node = prop.children[1];
  }
  return null;
}

export function pointerToOffset(raw: string, pointer: string): number {
  if (pointer === "") return 0;
  const root = parseTree(raw);
  if (!root) return 0;
  const segments = pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  const node = getNodeKey(root, segments);
  return node ? node.offset : 0;
}
