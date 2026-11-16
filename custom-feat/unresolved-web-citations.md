# Unresolved web citations

- Status: active
- Ledger entry: "Unresolved web citations"

## Original requirement

Chat replies displayed raw provider citation controls such as
`\uE200cite\uE202turn947199search0\uE201`. Their private-use characters appeared
as missing glyphs around internal search IDs.

## Design

The current assistant timeline carries text, without a reference-ID-to-URL map.
The shared Markdown source adapter omits only recognized unresolved web citation
controls in prose. It does not invent URLs or label an unresolved ID as a source.
Normal Markdown links remain clickable.

`components/markdown/citation-source.ts` owns the provider syntax. The existing
Markdown AST traversal applies it to text nodes, preserving inline and fenced
code. At the source tail, valid incomplete citation prefixes stay hidden while
streaming. Unknown controls and unrelated private-use text remain untouched.

This is a render-only fallback: stored messages, provider history and model
context retain their original text. Reopening older messages uses the same
adapter. It is not complete citation support; resolved source links require
source metadata to reach the renderer.

Unit coverage lives in `components/markdown/renderer.test.ts`. The existing
`streaming-markdown.spec.ts` browser suite covers partial controls, completed
replies, ordinary links and reload at desktop and phone widths.
