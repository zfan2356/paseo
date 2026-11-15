// Web/desktop material tokens. Native keeps the upstream theme. See docs/fork/design-materials.md.
export const MATERIAL = {
  glass: { opacity: 0.76, sidebarOpacity: 0.74, blur: 20, saturation: 1.3 },
  elevation: {
    hint: {
      surfaces: ["tooltip", "toast", "secondary"],
      radius: 10,
      shadow: { light: "0 4px 16px rgba(24,46,34,0.14)", dark: "0 4px 16px rgba(0,0,0,0.38)" },
      border: { light: "1px solid rgba(24,46,34,0.10)", dark: "1px solid rgba(255,255,255,0.16)" },
      material: { name: "protected", minimumOpacity: 0.96, maximumBlur: 8 },
    },
    popover: {
      surfaces: ["menu", "popover", "autocomplete", "banner", "callout", "secondary-expanded"],
      radius: 16,
      shadow: {
        light: "0 12px 36px rgba(24,46,34,0.14), inset 0 1px 0 rgba(255,255,255,0.65)",
        dark: "0 12px 36px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.12)",
      },
      border: {
        light: "1px solid rgba(255,255,255,0.65)",
        dark: "1px solid rgba(255,255,255,0.18)",
      },
      material: { name: "glass", minimumOpacity: 0, maximumBlur: 20 },
    },
    modal: {
      surfaces: ["composer", "dialog", "sheet", "fullscreen"],
      radius: 24,
      shadow: { light: "0 20px 56px rgba(24,46,34,0.20)", dark: "0 20px 56px rgba(0,0,0,0.48)" },
      border: {
        light: "1px solid rgba(255,255,255,0.65)",
        dark: "1px solid rgba(255,255,255,0.18)",
      },
      material: { name: "glass", minimumOpacity: 0, maximumBlur: 20 },
    },
  },
  // Window skeleton: the workspace floats as one panel on the sidebar-material floor.
  panel: {
    inset: 8,
    radius: 12,
    // Black mixed into the floor so the panel reads as raised in both schemes.
    floorShade: { light: 5, dark: 40 },
    border: { light: "1px solid rgba(24,46,34,0.12)", dark: "1px solid rgba(255,255,255,0.14)" },
    shadow: {
      light: "0 1px 2px rgba(24,46,34,0.08), 0 8px 24px rgba(24,46,34,0.10)",
      dark: "0 1px 2px rgba(0,0,0,0.50), 0 8px 24px rgba(0,0,0,0.45)",
    },
  },
  menuMinWidth: 240,
  spacing: { composer: 20, menu: 6, banner: 12, secondary: 8 },
  icon: { size: 16, action: 20, stroke: 1.5 },
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', sans-serif",
  motion: { duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  light: {
    surface: "#ffffff",
    content: "#f7f9f6",
    foreground: "#151b18",
    foregroundMuted: "#303a33",
    control: "rgba(24,46,34,0.08)",
  },
  dark: {
    surface: "#121a16",
    content: "#171e1b",
    foreground: "#ffffff",
    foregroundMuted: "#f0f4f1",
    control: "rgba(255,255,255,0.12)",
  },
} as const;
