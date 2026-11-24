import { renderToString } from "katex";

export function renderMathToMarkup(expression: string, displayMode: boolean): string {
  return renderToString(expression, {
    displayMode,
    output: "mathml",
    strict: "ignore",
    throwOnError: false,
  });
}
