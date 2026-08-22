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

- Parsing: `markdown-it-texmath` is added to the Markdown pipeline, with a
  fork-owned guard layer (`math-parser.ts`) that rejects currency-like and
  inline-code false positives before treating a span as math.
- Rendering: KaTeX generates **self-contained MathML** (no KaTeX stylesheet
  needed), emitted through dedicated components under
  `packages/app/src/components/markdown/math-expression*`.
- Theming: formula roots and nested `<math>` elements inherit the
  surrounding Markdown text color instead of KaTeX defaults, so formulas
  stay readable on Pure Black.
- All delimiter styles above are supported; shared and assistant-specific
  Markdown paths both go through the same math plugin.

### Known limitation

Native (iOS/Android) shows readable delimited formula source rather than
rendered MathML. This is an accepted gap, not an equivalent implementation.
If upstream ever ships math rendering, the fork implementation should be
dropped only after delimiter behavior, currency safety, and theme
inheritance are proven equivalent.
