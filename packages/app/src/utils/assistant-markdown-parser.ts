import MarkdownIt from "markdown-it";
import { enableMarkdownMath } from "@/components/markdown/math-parser";

export function createAssistantMarkdownParser(): MarkdownIt {
  const parser = enableMarkdownMath(
    new MarkdownIt({
      html: false,
      linkify: true,
      typographer: true,
    }),
  );
  const defaultValidateLink = parser.validateLink.bind(parser);

  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  return parser;
}
