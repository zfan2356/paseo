import { useEffect } from "react";
import { withUnistyles } from "react-native-unistyles";
import { MATERIAL_PREVIEW, type Theme } from "./theme";

/** Preview only: localStorage['paseo:material-preview'] = 'glass'; reload to enable. */
function PreviewStyles({ theme }: { theme: Theme }) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.materialPreview = localStorage.getItem("paseo:material-preview") ?? "solid";
    const tokens = MATERIAL_PREVIEW;
    const palette = tokens[theme.colorScheme];
    const surface = theme.colors.surface0;
    const style = document.createElement("style");
    style.dataset.materialPreviewStyles = "true";
    // CSS media queries also react to accessibility changes while the window is open.
    style.textContent = `
      @media (prefers-reduced-transparency: no-preference) {
        html[data-material-preview="glass"] {
          --paseo-material-muted: ${palette.foregroundMuted};
          --paseo-sidebar-material: color-mix(in srgb, ${surface} ${tokens.sidebarOpacity * 100}%, transparent);
        }
        html[data-material-preview="glass"] [data-material="window"] { background: transparent !important; }
        html[data-material-preview="glass"] [data-material="composer"],
        html[data-material-preview="glass"] [data-material="menu"],
        html[data-material-preview="glass"] [data-material="dialog"],
        html[data-material-preview="glass"] [data-material="header"],
        html[data-material-preview="glass"] [data-material="sheet"] {
          background: color-mix(in srgb, ${surface} ${tokens.opacity * 100}%, transparent) !important;
          backdrop-filter: blur(${tokens.blur}px) saturate(${tokens.saturation});
          border-color: ${palette.border} !important;
          box-shadow: ${palette.shadow};
        }
        ${Object.entries(tokens.radius)
          .map(
            ([role, radius]) =>
              `html[data-material-preview="glass"] [data-material="${role}"] { border-width: ${tokens.hairline}px; border-radius: ${radius}px !important; }`,
          )
          .join("\n")}
        html[data-material-preview="glass"] [data-material="dialog"] { box-shadow: ${palette.dialogShadow}; }
        html[data-material-preview="glass"] [data-material="header"] { box-shadow: none; }
      }
      html[data-material-preview="glass"] [data-material="dock-composer"] { position: absolute; bottom: 0; }
      html[data-material-preview="glass"] [data-material="dock"] [data-testid="agent-chat-scroll"] > div::after {
        content: ""; display: block; flex-shrink: 0; height: var(--paseo-composer-clearance, 180px);
      }
      @media (prefers-reduced-motion: no-preference) {
        html[data-material-preview="glass"] [data-material="composer"] {
          transition: border-color ${tokens.motion.duration}ms ${tokens.motion.easing};
        }
      }
    `;
    document.head.append(style);
    return () => style.remove();
  }, [theme]);
  return null;
}

export const MaterialPreview = withUnistyles(PreviewStyles, (theme) => ({ theme }));
