import * as katex from "katex";
import type MarkdownIt from "markdown-it";
import texmath from "markdown-it-texmath";

export function enableMarkdownMath<T extends MarkdownIt>(parser: T): T {
  parser.use(texmath, {
    engine: katex,
    delimiters: ["dollars", "brackets"],
    katexOptions: {
      output: "mathml",
      strict: "ignore",
      throwOnError: false,
    },
  });
  return parser;
}
