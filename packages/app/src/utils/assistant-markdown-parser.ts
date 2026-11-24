import type MarkdownIt from "markdown-it";
import { enableMarkdownMath } from "@/components/markdown/math-parser";
import { createMarkdownParser } from "@/utils/markdown-parser";

export function createAssistantMarkdownParser(): MarkdownIt {
  const parser = enableMarkdownMath(createMarkdownParser({ linkify: true }));
  const defaultValidateLink = parser.validateLink.bind(parser);

  // Rich clipboard HTML preserves workspace file links.
  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  return parser;
}
