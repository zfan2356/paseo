import { nativeTheme, type BrowserWindow, type BrowserWindowConstructorOptions } from "electron";

// This branch is a visual study; shipping builds retain the existing window material.
export const materialPreviewEnabled =
  process.platform === "darwin" && process.env.PASEO_MATERIAL_PREVIEW === "1";

const opaqueBackgrounds = new WeakMap<BrowserWindow, string>();

export function materialWindowOptions(backgroundColor: string): BrowserWindowConstructorOptions {
  if (!materialPreviewEnabled) return { backgroundColor };
  return {
    transparent: true,
    backgroundColor: nativeTheme.prefersReducedTransparency ? backgroundColor : "#00000000",
    vibrancy: nativeTheme.prefersReducedTransparency ? undefined : "sidebar",
    visualEffectState: "followWindow",
  };
}

export function updateMaterialBackground(win: BrowserWindow, backgroundColor: string): void {
  opaqueBackgrounds.set(win, backgroundColor);
  win.setBackgroundColor(
    materialPreviewEnabled && !nativeTheme.prefersReducedTransparency
      ? "#00000000"
      : backgroundColor,
  );
}

export function setupMaterialPreview(win: BrowserWindow, backgroundColor: string): void {
  if (!materialPreviewEnabled) return;
  opaqueBackgrounds.set(win, backgroundColor);
  const update = () => {
    if (win.isDestroyed()) return;
    win.setVibrancy(nativeTheme.prefersReducedTransparency ? null : "sidebar");
    updateMaterialBackground(win, opaqueBackgrounds.get(win) ?? backgroundColor);
  };
  nativeTheme.on("updated", update);
  win.once("closed", () => nativeTheme.removeListener("updated", update));
}
