import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

const MATH_LINK_PREFIX = "paseo-math:";

export function parseMathLink(url: string): { expression: string; display: boolean } | null {
  const match = /^paseo-math:(inline|block):(.*)$/.exec(url);
  if (!match) return null;
  try {
    return { expression: decodeURIComponent(match[2]), display: match[1] === "block" };
  } catch {
    return null;
  }
}

export function prepareMathSource(source: string): string {
  if (!source.includes("$") && !source.includes("\\(") && !source.includes("\\[")) return source;
  const protectedRanges: Array<[number, number]> = [];
  function visit(node: Nodes): void {
    if (
      ["code", "inlineCode", "link", "linkReference", "image", "imageReference", "html"].includes(
        node.type,
      )
    ) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) protectedRanges.push([start, end]);
      return;
    }
    if ("children" in node) node.children.forEach(visit);
  }
  visit(fromMarkdown(source));
  const expressions =
    /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\$([^\s$](?:[^$]*?[^\s$])?)\$(?!\d)/g;
  return source.replace(
    expressions,
    (match, inlineBracket, blockBracket, blockDollar, inlineDollar, offset: number) => {
      if (protectedRanges.some(([start, end]) => offset < end && offset + match.length > start))
        return match;
      if (
        source[offset - 1] === "\\" ||
        (inlineDollar !== undefined && /\d/.test(source[offset - 1] ?? ""))
      )
        return match;
      const display = blockBracket !== undefined || blockDollar !== undefined;
      const expression = inlineBracket ?? blockBracket ?? blockDollar ?? inlineDollar;
      return `[math](${MATH_LINK_PREFIX}${display ? "block" : "inline"}:${encodeURIComponent(expression).replaceAll("(", "%28").replaceAll(")", "%29")})`;
    },
  );
}
