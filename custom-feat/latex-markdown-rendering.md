# LaTeX rendering in Markdown

- Status: active
- Commits: `9f92a3fd1`, `bab467cbc`
- Ledger entry: "LaTeX rendering in Markdown"

## Original requirement

Assistant replies frequently contain math (`$...$`, `$$...$$`, `\(...\)`,
`\[...\]`). Upstream rendered these as raw source text, which makes
model-heavy technical conversations hard to read. The requirement: render
LaTeX formulas properly in chat on desktop and browser, without breaking
ordinary text ("$5 and $10" must not become a formula) and with correct
colors under the dark / Pure Black themes.

## Design

- The shared enriched Markdown renderer remains the only prose renderer.
  `math-source.ts` adapts dollar and bracket math to private render links on
  web, excluding code, authored links, images, and raw HTML using source ranges.
- The web link renderer recognizes those links and uses the existing
  `MathExpression` component. KaTeX produces self-contained MathML and the
  current theme supplies the surrounding foreground color.
- `markdown-it-texmath` remains in the clipboard parser; its render output uses
  the same MathML settings. Native keeps the original delimited source.
- Tests cover code/currency preservation, both delimiters, and browser theme
  inheritance through the actual enriched renderer.

### Known limitation

Native (iOS/Android) shows readable delimited formula source rather than
rendered MathML. This is an accepted gap, not an equivalent implementation.
If upstream ever ships math rendering, the fork implementation should be
dropped only after delimiter behavior, currency safety, and theme
inheritance are proven equivalent.
