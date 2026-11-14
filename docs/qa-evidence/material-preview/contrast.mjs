import fs from "node:fs";
import { runInNewContext } from "node:vm";

// Evaluate only this checkout's literal token object, not the RN module or its imports.
const source = fs.readFileSync("packages/app/src/styles/theme.ts", "utf8");
const literal = source.match(/export const MATERIAL_PREVIEW = (\{[\s\S]*?\n\}) as const;/)?.[1];
if (!literal) throw new Error("Material token object not found");
const tokens = runInNewContext(`(${literal})`);
const rgb = (hex) => hex.match(/[a-f\d]{2}/gi).map((channel) => Number.parseInt(channel, 16));
const luminance = (channels) =>
  channels
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (foreground, background) => {
  const [high, low] = [luminance(rgb(foreground)), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (high + 0.05) / (low + 0.05);
};
const rows = [];
for (const scheme of ["light", "dark"]) {
  const palette = tokens[scheme];
  const backdrop = scheme === "light" ? 0 : 255;
  for (const [strength, level] of Object.entries(tokens.levels)) {
    for (const [surface, opacity] of Object.entries({
      floating: level.opacity,
      sidebar: level.sidebarOpacity,
    })) {
      const composited = rgb(palette.surface).map(
        (channel) => channel * opacity + backdrop * (1 - opacity),
      );
      const colors = {
        body: scheme === "light" ? "#1a1a1e" : "#fafafa",
        secondary: palette.foregroundMuted,
        ...palette.status,
      };
      for (const [role, color] of Object.entries(colors))
        rows.push({
          scheme,
          strength,
          surface,
          opacity,
          role,
          color,
          backdrop,
          composited,
          ratio: contrast(color, composited),
        });
    }
  }
}
if (rows.some((row) => row.ratio < 4.5)) throw new Error("Glass text fell below 4.5:1");
fs.writeFileSync(
  "docs/qa-evidence/material-preview/contrast.json",
  JSON.stringify(
    {
      method:
        "sRGB alpha composite over worst-case black/light and white/dark; WCAG relative luminance; values read from theme.ts",
      rows,
    },
    null,
    2,
  ),
);
console.log("minimum", Math.min(...rows.map((row) => row.ratio)).toFixed(2));
