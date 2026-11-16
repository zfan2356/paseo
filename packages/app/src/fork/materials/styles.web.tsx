import { useEffect } from "react";
import { getIsElectronMac } from "@/constants/platform";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { MATERIAL } from "./tokens";

type MaterialLevel = typeof MATERIAL.glass;
type Scheme = Theme["colorScheme"];
// Fixed-size glyphs only; a percentage-sized svg (a scrim or fill) takes its box from its parent.
const ICON = 'svg:not([width$="%"])';

function elevationCss(root: string, scheme: Scheme, material: MaterialLevel): string {
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

// Window skeleton: the workspace panel meets the window on its top, right and bottom edges and
// floats off the sidebar-material floor only beside the pinned sidebar. The overlay sidebar
// (collapsed, or a narrow wide window) carries no `sidebar` slot, so the panel then fills the frame.
function skeletonCss(root: string, scheme: Theme["colorScheme"], surfaceSidebar: string): string {
  const { panel } = MATERIAL;
  const sidebarMaterial = `var(--paseo-sidebar-material, ${surfaceSidebar})`;
  const pinned = `${root}:has([data-material="sidebar"])`;
  return `
    ${root} { --paseo-floor: color-mix(in srgb, ${sidebarMaterial}, black ${panel.floorShade[scheme]}%); }
    ${root} [data-material="sidebar"] { background: var(--paseo-floor) !important; border-right-width: 0 !important; }
    ${root} [data-material="panel-frame"] { background: var(--paseo-floor); }
    ${root} [data-material="panel"] { background: ${MATERIAL[scheme].content}; overflow: hidden; }
    ${pinned} [data-material="panel-frame"] { padding-left: ${panel.inset}px; }
    ${pinned} [data-material="panel"] {
      border-radius: ${panel.radius}px 0 0 ${panel.radius}px;
      border-left: ${panel.border[scheme]}; box-shadow: ${panel.shadow[scheme]};
    }
    /* The sidebar's resize handle (its last child, a lone focusable strip) straddles the sidebar
       edge; centre it on the gap. The sidebar's ancestors stop clipping it, and the panel's wrappers
       let pointers through the gap so it stays hittable under them; the panel itself still takes
       pointers. */
    ${pinned} [data-material="sidebar"] > :last-child > [tabindex]:only-child { transform: translateX(${panel.inset / 2}px); }
    ${pinned} div:has([data-material="sidebar"]):not(:has([data-material="panel-frame"])) { overflow: visible; }
    ${pinned} div:has([data-material="panel-frame"]):not(:has([data-material="sidebar"])),
    ${pinned} [data-material="panel-frame"] { pointer-events: none; }
    ${root} [data-material="panel"] { pointer-events: auto; }
    ${explorerCss(root, scheme)}
    ${settingsCss(root, scheme)}
  `;
}

// The docked Explorer sits on the floor like the pinned sidebar, so only the workspace column
// floats. Its resize separator renders only while the Explorer is docked open on the active
// workspace, which makes it the open-state signal. The panel and every layer down to the
// workspace row go clear; the column takes the panel's fill, corners, border and shadow.
function explorerCss(root: string, scheme: Scheme): string {
  const { panel } = MATERIAL;
  const row = '[data-material="workspace-row"]';
  const explorer = `${row} > :not(:first-child)`;
  const separator = '[role="separator"][aria-orientation="vertical"]';
  const panelOpen = `[data-material="panel"]:has(${explorer} ${separator})`;
  const open = `${root} ${panelOpen}`;
  const pinned = `${root}:has([data-material="sidebar"]) ${panelOpen}`;
  return `
    ${open} { background: transparent; border-radius: 0; border-left: 0; box-shadow: none; overflow: visible; }
    ${open} div:has(${row}), ${open} ${row} { background: transparent !important; }
    ${open} ${row} > :first-child {
      margin-right: ${panel.inset}px; background: ${MATERIAL[scheme].content}; overflow: hidden;
      border-top-right-radius: ${panel.radius}px; border-bottom-right-radius: ${panel.radius}px;
      border-right: ${panel.border[scheme]}; box-shadow: ${panel.shadow[scheme]};
    }
    ${pinned} ${row} > :first-child {
      border-top-left-radius: ${panel.radius}px; border-bottom-left-radius: ${panel.radius}px;
      border-left: ${panel.border[scheme]};
    }
    ${open} ${explorer} { --colors-surface-sidebar: transparent; }
    ${open} ${explorer} div:has(${separator}) { background: transparent !important; overflow: visible; }
    ${open} ${explorer} [data-material="header"] { background: transparent !important; backdrop-filter: none; }
    ${open} ${explorer} :has(> ${separator}) {
      background: transparent !important; transform: translateX(-${panel.inset / 2}px);
    }
    ${open} ${explorer} ${separator} { transform: translateX(-50%); }
  `;
}

// Settings uses the same skeleton inside the workspace panel: its navigation sits on the floor and
// its detail pane floats off it. Everything between the panel frame and the settings root goes
// clear so the floor (and the macOS vibrancy under it) shows through once, as beside the sidebar.
function settingsCss(root: string, scheme: Scheme): string {
  const { panel } = MATERIAL;
  const settings = '[data-material="settings"]';
  return `
    ${root} [data-material="panel-frame"]:has(${settings}) { padding-left: 0; }
    ${root} [data-material="panel"]:has(${settings}) {
      background: transparent; border-radius: 0; border-left: 0; box-shadow: none;
    }
    ${root} [data-material="panel"] div:has(${settings}), ${root} ${settings} { background: transparent !important; }
    ${root} ${settings} > * > [role="navigation"] { background: transparent !important; border-right-width: 0 !important; }
    ${root} ${settings} > * > :last-child {
      margin-left: ${panel.inset}px; background: ${MATERIAL[scheme].content}; overflow: hidden;
      border-radius: ${panel.radius}px 0 0 ${panel.radius}px;
      border-left: ${panel.border[scheme]}; box-shadow: ${panel.shadow[scheme]};
    }
  `;
}

// Composer pills float over the transcript, so each one takes the hint material.
function composerPillCss(root: string, scheme: Scheme): string {
  const hint = MATERIAL.elevation.hint;
  const tracks = `${root} [data-material="composer-tracks"]`;
  // Outermost buttons only: a control nested inside a pill keeps the pill's material.
  const pill = `${tracks} [role="button"]:not([role="button"] [role="button"])`;
  // The pills sit in a horizontal scroller (scroller > content > track > pill) that clips to the
  // pill height. Pad the scroller by the shadow's reach and pull it back with negative margins, so
  // the shadow keeps the pill's radius instead of being cut to its bounding box.
  const room = hint.shadowReach;
  const scroller = `${tracks} :has(> * > * > [role="button"]):not([role="button"], [role="button"] *)`;
  return `
    ${scroller} {
      padding: ${room.top}px ${room.side}px ${room.bottom}px;
      margin: -${room.top}px -${room.side}px -${room.bottom}px;
    }
    ${pill} { border: ${hint.border[scheme]} !important; box-shadow: ${hint.shadow[scheme]}; }
    @media (prefers-reduced-transparency: no-preference) {
      ${pill} {
        background: color-mix(in srgb, ${MATERIAL[scheme].surface} ${hint.material.minimumOpacity * 100}%, transparent) !important;
        backdrop-filter: blur(${hint.material.maximumBlur}px) saturate(${MATERIAL.glass.saturation});
      }
    }
    @media (prefers-reduced-transparency: reduce) {
      ${pill} { background: ${MATERIAL[scheme].surface} !important; }
    }
  `;
}

function MaterialStyles({
  colorScheme,
  surfaceSidebar,
}: {
  colorScheme: Theme["colorScheme"];
  surfaceSidebar: string;
}) {
  useEffect(() => {
    const t = MATERIAL;
    const palette = t[colorScheme];
    const style = document.createElement("style");
    style.dataset.materialStyles = "true";
    const material = t.glass;
    const root = "html";
    style.textContent = `
        ${root} [data-material="window"] { background: ${getIsElectronMac() ? "transparent" : palette.content} !important; }
        ${skeletonCss(root, colorScheme, surfaceSidebar)}
        ${composerPillCss(root, colorScheme)}
        ${root} [data-material="dock"], ${root} [data-material="transcript"] { background: ${palette.content}; }
        ${root} [data-material="chrome"] {
          position: absolute; top: 0; left: 0; right: 0; z-index: 10;
        }
        ${root} [data-material="chrome"] div { border-color: transparent !important; }
        ${root} [data-material="chrome"] div:not([role="button"]) { background-color: transparent !important; }
        ${root} [data-material="chrome"] [data-material="header"] { background: transparent !important; backdrop-filter: none; }
        ${root} [data-material="chat-find"] { transform: translateY(var(--paseo-chrome-clearance, 0px)); }
        ${root} [data-material="dock-composer"] { position: absolute; bottom: 0; }
        ${root} [data-material="dock"] [data-material="scroll-controls"], ${root} [data-material="dock"] [data-material="composer-tracks"] { transform: translateY(calc(-1 * var(--paseo-composer-clearance, 0px))); }
        ${root} [data-material="transcript-content"]::before {
          content: ""; display: block; flex-shrink: 0; height: calc(var(--paseo-chrome-clearance, 0px) + 40px);
        }
        ${root} [data-material="dock"] [data-material="transcript-content"]::after {
          content: ""; display: block; flex-shrink: 0; height: var(--paseo-composer-clearance, 180px);
        }
        ${root} [data-material="secondary"], ${root} [data-material="secondary-expanded"] {
          position: absolute; top: calc(var(--paseo-chrome-clearance, 0px) + ${t.spacing.secondary}px);
          right: 16px; z-index: 11; border: 0; border-radius: 12px; max-width: min(520px, calc(100% - 32px));
        }
        ${root} [data-material="secondary"] [role="button"] { min-height: 28px; padding: 4px 10px; }
        ${root} [data-material="secondary"] [role="button"] div { font-size: 12px !important; }
        ${root} [data-material="banner"] {
          margin: ${t.spacing.banner}px; width: calc(100% - ${t.spacing.banner * 2}px); padding: 16px;
          gap: ${t.spacing.banner}px;
        }
        ${root} [data-material="banner"] [role="button"]:not([aria-label]) {
          background: ${palette.control} !important; border: 0; border-radius: 10px; min-height: 32px;
        }
        ${root} [data-material="banner"] [role="button"]:not([aria-label]) div { color: ${palette.foreground} !important; }
        ${root} [data-material="composer"] { padding: ${t.spacing.composer}px; gap: 16px; }
        ${root} [data-material="menu"] { padding: ${t.spacing.menu}px; min-width: min(${t.menuMinWidth}px, calc(100vw - 32px)); }
        ${root} [data-material="dialog"] { max-width: 560px; }
        ${root} [data-material="dialog"] > div { border-color: transparent !important; }
        ${root} [data-material="header"] svg, ${root} [data-material="menu"] svg, ${root} [data-material="banner"] svg, ${root} [data-material="composer"] svg { stroke-width: ${t.icon.stroke}; }
        ${root} [data-material="header"] ${ICON}, ${root} [data-material="menu"] ${ICON},
        ${root} [data-material="banner"] ${ICON} { width: ${t.icon.size}px; height: ${t.icon.size}px; }
        ${root} [data-material="composer"] ${ICON} { width: ${t.icon.action}px; height: ${t.icon.action}px; }
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
        ${elevationCss(root, colorScheme, material)}
        @media (prefers-reduced-motion: no-preference) {
          ${root} [data-material="composer"] { transition: border-color ${t.motion.duration}ms ${t.motion.easing}; }
        }
      `;
    document.head.append(style);
    return () => style.remove();
  }, [colorScheme, surfaceSidebar]);
  return null;
}
// Read theme fields during render so Unistyles subscribes before saved appearance loads.
export const Materials = withUnistyles(MaterialStyles, (theme) => ({
  colorScheme: theme.colorScheme,
  surfaceSidebar: theme.colors.surfaceSidebar,
}));
