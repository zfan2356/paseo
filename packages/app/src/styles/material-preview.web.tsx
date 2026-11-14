import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { withUnistyles } from "react-native-unistyles";
import { MATERIAL_PREVIEW, type Theme } from "./theme";

type Strength = "solid" | keyof typeof MATERIAL_PREVIEW.levels;
const choices: { value: Strength; label: string }[] = [
  { value: "solid", label: "原样" },
  ...Object.entries(MATERIAL_PREVIEW.levels).map(([value, spec]) => ({
    value: value as Strength,
    label: spec.label,
  })),
];

/** Opt in through localStorage['paseo:material-preview']; the study is never enabled by default. */
function PreviewStyles({ theme }: { theme: Theme }) {
  const [enabled, setEnabled] = useState(false);
  const [strength, setStrength] = useState<Strength>("solid");
  const selectStrength = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => setStrength(event.currentTarget.value as Strength),
    [],
  );
  useEffect(() => {
    const saved = localStorage.getItem("paseo:material-preview");
    setEnabled(saved !== null);
    setStrength(
      choices.some((choice) => choice.value === saved) ? (saved as Strength) : "balanced",
    );
  }, []);
  useEffect(() => {
    document.documentElement.dataset.materialPreview = enabled ? strength : "solid";
    if (enabled) localStorage.setItem("paseo:material-preview", strength);
  }, [enabled, strength]);
  useEffect(() => {
    const t = MATERIAL_PREVIEW;
    const palette = t[theme.colorScheme];
    const style = document.createElement("style");
    style.dataset.materialPreviewStyles = "true";
    style.textContent = Object.entries(t.levels)
      .map(([level, material]) => {
        const root = `html[data-material-preview="${level}"]`;
        return `
        ${root} { --paseo-material-muted: ${palette.foregroundMuted}; ${Object.entries(
          palette.status,
        )
          .map(([role, color]) => `--paseo-status-${role}: ${color};`)
          .join(" ")} }
        ${root} [data-material="window"] { background: transparent !important; }
        ${root} [data-material="dock"], ${root} [data-testid="agent-chat-scroll"] { background: ${palette.content}; }
        ${root} [data-material="chrome"] {
          position: absolute; top: 0; left: 0; right: 0; z-index: 10;
        }
        ${root} [data-material="chrome"] div { border-color: transparent !important; }
        ${root} [data-material="chrome"] div:not([role="button"]) { background-color: transparent !important; }
        ${root} [data-material="chrome"] [data-material="header"] { background: transparent !important; backdrop-filter: none; }
        ${root} [data-material="dock-composer"] { position: absolute; bottom: 0; }
        ${root} [data-testid="agent-chat-scroll"] > div::before {
          content: ""; display: block; flex-shrink: 0; height: calc(var(--paseo-chrome-clearance, 0px) + 40px);
        }
        ${root} [data-material="dock"] [data-testid="agent-chat-scroll"] > div::after {
          content: ""; display: block; flex-shrink: 0; height: var(--paseo-composer-clearance, 180px);
        }
        ${root} [data-material="secondary"], ${root} [data-material="secondary-expanded"] {
          position: absolute; top: calc(var(--paseo-chrome-clearance, 0px) + ${t.spacing.secondary}px);
          right: 16px; z-index: 11; border: 0; border-radius: 12px; max-width: min(520px, calc(100% - 32px));
          background: ${palette.banner};
        }
        ${root} [data-material="secondary"] [role="button"] { min-height: 28px; padding: 4px 10px; }
        ${root} [data-material="secondary"] [role="button"] div { font-size: 12px !important; }
        ${root} [data-material="banner"] {
          margin: ${t.spacing.banner}px; width: calc(100% - ${t.spacing.banner * 2}px); padding: 16px;
          border: 0; border-radius: ${t.radius.banner}px; background: ${palette.banner};
          box-shadow: ${palette.shadow}; gap: ${t.spacing.banner}px;
        }
        ${root} [data-material="banner"] [role="button"]:not([aria-label]) {
          background: ${palette.control} !important; border: 0; border-radius: 10px; min-height: 32px;
        }
        ${root} [data-material="banner"] [role="button"]:not([aria-label]) div { color: ${palette.foreground} !important; }
        ${root} [data-material="composer"] { padding: ${t.spacing.composer}px; gap: 16px; }
        ${root} [data-material="menu"] { padding: ${t.spacing.menu}px; }
        ${root} [data-material="dialog"] { max-width: 560px; }
        ${root} [data-material="dialog"] > div { border-color: transparent !important; }
        ${root} [data-material] svg { stroke-width: ${t.icon.stroke}; }
        ${root} [data-material="header"] svg, ${root} [data-material="menu"] svg,
        ${root} [data-material="banner"] svg { width: ${t.icon.size}px; height: ${t.icon.size}px; }
        ${root} [data-material="composer"] svg { width: ${t.icon.action}px; height: ${t.icon.action}px; }
        ${root} [data-material="chrome"] div, ${root} [data-material="menu"] div, ${root} [data-material="banner"] div, ${root} [data-material="composer"] textarea, ${root} [data-material="dialog"] div {
          font-family: ${t.font};
        }
        @media (prefers-reduced-transparency: no-preference) {
          ${root} { --paseo-sidebar-material: color-mix(in srgb, ${palette.surface} ${material.sidebarOpacity * 100}%, transparent); }
          ${root} [data-material="composer"], ${root} [data-material="menu"],
          ${root} [data-material="dialog"], ${root} [data-material="sheet"],
          ${root} [data-material="chrome"], ${root} [data-material="header"] {
            background: color-mix(in srgb, ${palette.surface} ${material.opacity * 100}%, transparent) !important;
            backdrop-filter: blur(${material.blur}px) saturate(${material.saturation});
            border-color: ${palette.border} !important;
            box-shadow: ${palette.shadow};
          }
          ${root} [data-material="chrome"] [data-material="header"] { background: transparent !important; backdrop-filter: none; box-shadow: none; }
          ${root} [data-material="chrome"], ${root} [data-material="header"] { box-shadow: none; border: 0; }
        }
        ${Object.entries(t.radius)
          .map(
            ([role, radius]) =>
              `${root} [data-material="${role}"] { border-radius: ${radius}px !important; }`,
          )
          .join("\n")}
        ${root} [data-material="dialog"] { box-shadow: ${palette.dialogShadow}; }
        @media (prefers-reduced-transparency: reduce) {
          ${root} [data-material="window"] { background: ${palette.content} !important; }
          ${root} [data-material="chrome"], ${root} [data-material="header"],
          ${root} [data-material="composer"], ${root} [data-material="menu"],
          ${root} [data-material="dialog"], ${root} [data-material="sheet"] { background: ${palette.surface} !important; backdrop-filter: none; }
        }
        @media (prefers-reduced-motion: no-preference) {
          ${root} [data-material="composer"] { transition: border-color ${t.motion.duration}ms ${t.motion.easing}; }
        }
      `;
      })
      .join("\n");
    document.head.append(style);
    return () => style.remove();
  }, [theme]);
  if (!enabled) return null;
  return (
    <aside data-testid="material-preview-switch" style={switchStyle} aria-label="材质预览">
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          aria-pressed={strength === choice.value}
          style={strength === choice.value ? selectedChoiceStyle : choiceStyle}
          value={choice.value}
          onClick={selectStrength}
        >
          {choice.label}
        </button>
      ))}
    </aside>
  );
}
const switchStyle = {
  position: "fixed",
  right: 12,
  bottom: 12,
  zIndex: 100000,
  display: "flex",
  gap: 4,
  padding: 8,
  borderRadius: 12,
  background: "#e5ede8",
  boxShadow: "0 4px 20px #0003",
} as const;
const choiceStyle = {
  border: 0,
  borderRadius: 8,
  padding: "6px 10px",
  color: "#294434",
  background: "transparent",
  fontFamily: MATERIAL_PREVIEW.font,
  fontSize: 12,
  cursor: "pointer",
} as const;
const selectedChoiceStyle = { ...choiceStyle, background: "#fff", fontWeight: 600 } as const;
export const MaterialPreview = withUnistyles(PreviewStyles, (theme) => ({ theme }));
