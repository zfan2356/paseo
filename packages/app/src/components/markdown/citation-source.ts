const CITATION_PREFIX = "\uE200cite\uE202";
const REFERENCE_SOURCE = String.raw`turn\d+[a-z]+\d+`;
const REFERENCE = new RegExp(`^${REFERENCE_SOURCE}$`);
const COMPLETE_CITATION = new RegExp(
  `${CITATION_PREFIX}${REFERENCE_SOURCE}(?:\uE202${REFERENCE_SOURCE})*\uE201`,
  "g",
);

// The timeline carries opaque reference IDs, not the source URLs they require.
// Suppress their display syntax without changing stored messages or guessing links.
export function omitUnresolvedCitations(text: string, options: { isTail: boolean }): string {
  const rendered = text.replace(COMPLETE_CITATION, "");
  if (!options.isTail) return rendered;
  const start = rendered.lastIndexOf("\uE200");
  if (start === -1) return rendered;
  const tail = rendered.slice(start);
  if (CITATION_PREFIX.startsWith(tail)) return rendered.slice(0, start);
  if (!tail.startsWith(CITATION_PREFIX)) return rendered;

  const references = tail.slice(CITATION_PREFIX.length).split("\uE202");
  const partial = references.pop()!;
  const completeReferences = references.every((reference) => REFERENCE.test(reference));
  const partialReference = "turn".startsWith(partial) || /^turn\d+(?:[a-z]+\d*)?$/.test(partial);
  return completeReferences && partialReference ? rendered.slice(0, start) : rendered;
}
