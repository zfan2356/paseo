import fs from "node:fs";
const rgb = (h) => h.match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16));
const luminance = (c) =>
  c
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (x + 0.05) / (y + 0.05);
};
const rows = [];
for (const [scheme, surface, foregrounds, back] of [
  [
    "light",
    "#ffffff",
    {
      foreground: "#1a1a1e",
      foregroundMuted: "#5c605f",
      statusSuccess: "#3e704a",
      statusDanger: "#9d433b",
      statusWarning: "#7b5d39",
      statusMerged: "#7347af",
    },
    0,
  ],
  [
    "dark",
    "#181B1A",
    {
      foreground: "#fafafa",
      foregroundMuted: "#b3b7b5",
      statusSuccess: "#6cb17b",
      statusDanger: "#d8847b",
      statusWarning: "#c09664",
      statusMerged: "#a890d5",
    },
    255,
  ],
]) {
  const background = rgb(surface).map((v) => v * 0.9 + back * 0.1);
  for (const [role, hex] of Object.entries(foregrounds))
    rows.push({
      scheme,
      role,
      foreground: hex,
      surface,
      opacity: 0.9,
      backdrop: [back, back, back],
      composited: background,
      ratio: ratio(rgb(hex), background),
    });
}
fs.mkdirSync("docs/qa-evidence/material-preview", { recursive: true });
fs.writeFileSync(
  "docs/qa-evidence/material-preview/contrast.json",
  JSON.stringify(
    {
      method:
        "WCAG sRGB relative luminance, 90% surface over worst-case black (light) or white (dark), before rounding. Status text measured directly on glass; tinted badges retain their separate fills.",
      rows,
    },
    null,
    2,
  ),
);
