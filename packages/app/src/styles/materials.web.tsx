import { useEffect } from "react";
import { getIsElectronMac } from "@/constants/platform";
import { withUnistyles } from "react-native-unistyles";
import { MATERIAL, type Theme } from "./theme";

type MaterialLevel = typeof MATERIAL.glass;

function elevationCss(root: string, scheme: Theme["colorScheme"], material: MaterialLevel): string {
  const palette = MATERIAL[scheme];
  const rules = Object.values(MATERIAL.elevation).map((elevation) => {
    const selector = elevation.surfaces
      .map((role) => `${root} [data-material="${role}"]`)
      .join(", ");
    const opacity = Math.max(material.opacity, elevation.material.minimumOpacity);
    const blur = Math.min(material.blur, elevation.material.maximumBlur);
    return `
      ${selector} { border-radius: ${elevation.radius}px !important; border: ${elevation.border[scheme]} !important; box-shadow: ${elevation.shadow[scheme]} !important; }
      @media (prefers-reduced-transparency: no-preference) {
        ${selector} { background: color-mix(in srgb, ${palette.surface} ${opacity * 100}%, transparent) !important; backdrop-filter: blur(${blur}px) saturate(${material.saturation}); }
      }
      @media (prefers-reduced-transparency: reduce) {
        ${selector} { background: ${palette.surface} !important; backdrop-filter: none; }
      }
    `;
  });
  return (
    rules.join("\n") +
    `
    ${root} [data-material="tooltip"] div, ${root} [data-material="tooltip"] span, ${root} [data-material="toast"] div, ${root} [data-material="toast"] span { color: ${palette.foreground} !important; }
  `
  );
}

function MaterialStyles({ theme }: { theme: Theme }) {
  useEffect(() => {
    const t = MATERIAL;
    const palette = t[theme.colorScheme];
    const style = document.createElement("style");
    style.dataset.materialStyles = "true";
    const material = t.glass;
    const root = "html";
    style.textContent = `
        ${root} [data-material="window"] { background: ${getIsElectronMac() ? "transparent" : palette.content} !important; }
        ${root} [data-material="dock"], ${root} [data-testid="agent-chat-scroll"] { background: ${palette.content}; }
        ${root} [data-material="chrome"] {
          position: absolute; top: 0; left: 0; right: 0; z-index: 10;
        }
        ${root} [data-material="chrome"] div { border-color: transparent !important; }
        ${root} [data-material="chrome"] div:not([role="button"]) { background-color: transparent !important; }
        ${root} [data-material="chrome"] [data-material="header"] { background: transparent !important; backdrop-filter: none; }
        ${root} [data-chat-find-widget="true"] { transform: translateY(var(--paseo-chrome-clearance, 0px)); }
        ${root} [data-material="dock-composer"] { position: absolute; bottom: 0; }
        ${root} [data-material="dock"] [data-material="scroll-controls"] { transform: translateY(calc(-1 * var(--paseo-composer-clearance, 0px))); }
        ${root} [data-testid="agent-chat-scroll"] > div::before {
          content: ""; display: block; flex-shrink: 0; height: calc(var(--paseo-chrome-clearance, 0px) + 40px);
        }
        ${root} [data-material="dock"] [data-testid="agent-chat-scroll"] > div::after {
          content: ""; display: block; flex-shrink: 0; height: var(--paseo-composer-clearance, 180px);
        }
        ${root} [data-material="secondary"], ${root} [data-material="secondary-expanded"] {
          position: absolute; top: calc(var(--paseo-chrome-clearance, 0px) + ${t.spacing.secondary}px);
          right: 16px; z-index: 11; border: 0; border-radius: 12px; max-width: min(520px, calc(100% - 32px));
        }
        ${root} [data-material="secondary"] [role="button"] { min-height: 28px; padding: 4px 10px; }
        ${root} [data-material="secondary"] [role="button"] div { font-size: 12px !important; }
        ${root} [data-material="session-row"] { margin: 2px 8px; border-radius: 12px; padding: 4px 8px; }
        ${root} [data-material="banner"] {
          margin: ${t.spacing.banner}px; width: calc(100% - ${t.spacing.banner * 2}px); padding: 16px;
          gap: ${t.spacing.banner}px;
        }
        ${root} [data-material="banner"] [role="button"]:not([aria-label]) {
          background: ${palette.control} !important; border: 0; border-radius: 10px; min-height: 32px;
        }
        ${root} [data-material="banner"] [role="button"]:not([aria-label]) div { color: ${palette.foreground} !important; }
        ${root} [data-material="composer"] { padding: ${t.spacing.composer}px; gap: 16px; }
        ${root} [data-material="composer"] textarea::placeholder { color: ${palette.foregroundMuted} !important; opacity: 1; }
        ${root} [data-material="menu"] { padding: ${t.spacing.menu}px; min-width: min(${t.menuMinWidth}px, calc(100vw - 32px)); }
        ${root} [data-material="dialog"] { max-width: 560px; }
        ${root} [data-material="dialog"] > div { border-color: transparent !important; }
        ${root} [data-material="header"] svg, ${root} [data-material="menu"] svg, ${root} [data-material="banner"] svg, ${root} [data-material="composer"] svg { stroke-width: ${t.icon.stroke}; }
        ${root} [data-material="header"] svg, ${root} [data-material="menu"] svg,
        ${root} [data-material="banner"] svg { width: ${t.icon.size}px; height: ${t.icon.size}px; }
        ${root} [data-material="composer"] svg { width: ${t.icon.action}px; height: ${t.icon.action}px; }
        ${root} [data-material="chrome"] div, ${root} [data-material="menu"] div, ${root} [data-material="banner"] div, ${root} [data-material="composer"] textarea, ${root} [data-material="dialog"] div {
          font-family: ${t.font};
        }
        @media (prefers-reduced-transparency: no-preference) {
          ${getIsElectronMac() ? `${root} { --paseo-sidebar-material: color-mix(in srgb, ${palette.surface} ${material.sidebarOpacity * 100}%, transparent); }` : ""}
          ${root} [data-material="chrome"], ${root} [data-material="header"] {
            background: color-mix(in srgb, ${palette.surface} ${material.opacity * 100}%, transparent) !important;
            backdrop-filter: blur(${material.blur}px) saturate(${material.saturation});
          }
          ${root} [data-material="chrome"] [data-material="header"] { background: transparent !important; backdrop-filter: none; box-shadow: none; }
          ${root} [data-material="chrome"], ${root} [data-material="header"] { box-shadow: none; border: 0; }
        }


        @media (prefers-reduced-transparency: reduce) {
          ${root} { --paseo-sidebar-material: ${palette.surface}; }
          ${root} [data-material="window"] { background: ${palette.content} !important; }
          ${root} [data-material="chrome"], ${root} [data-material="header"],
          ${root} [data-material="composer"], ${root} [data-material="menu"],
          ${root} [data-material="dialog"], ${root} [data-material="sheet"] { background: ${palette.surface} !important; backdrop-filter: none; }
        }
        ${elevationCss(root, theme.colorScheme, material)}
        @media (prefers-reduced-motion: no-preference) {
          ${root} [data-material="composer"] { transition: border-color ${t.motion.duration}ms ${t.motion.easing}; }
        }
      `;
    document.head.append(style);
    return () => style.remove();
  }, [theme]);
  return null;
}
export const Materials = withUnistyles(MaterialStyles, (theme) => ({ theme }));
