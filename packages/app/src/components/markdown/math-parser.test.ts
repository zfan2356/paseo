import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { enableMarkdownMath } from "./math-parser";
import { renderMathToMarkup } from "./math-rendering";

function tokenTypes(source: string): string[] {
  const parser = enableMarkdownMath(new MarkdownIt({ typographer: true, linkify: true }));
  return parser
    .parse(source, {})
    .flatMap((token) => token.children ?? [token])
    .map((token) => token.type);
}

describe("markdown math", () => {
  it("parses dollar and bracket delimiters", () => {
    expect(tokenTypes("Inline $x^2$ and \\(y^2\\)")).toContain("math_inline");
    expect(tokenTypes("$$\\int_0^1 x^2 dx$$")).toContain("math_block");
    expect(tokenTypes("\\[\\sum_{i=1}^n i\\]")).toContain("math_block");
  });

  it("leaves currency and inline code as text", () => {
    expect(tokenTypes("The price is $5 and `cost = $5`.")).not.toContain("math_inline");
  });

  it("renders self-contained MathML", () => {
    const markup = renderMathToMarkup("x^2 + y^2", false);
    expect(markup).toContain("<math");
    expect(markup).toContain("<msup>");
    expect(markup).not.toContain("<link");
  });
});
