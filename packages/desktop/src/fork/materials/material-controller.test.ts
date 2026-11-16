import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createWindowMaterial } from "./material-controller";

class TestTheme extends EventEmitter {
  prefersReducedTransparency = false;
  sources: string[] = [];
  #source: "system" | "light" | "dark" = "system";
  get themeSource() {
    return this.#source;
  }
  set themeSource(value: "system" | "light" | "dark") {
    this.#source = value;
    this.sources.push(value);
    this.emit("updated");
  }
}
class TestWindow extends EventEmitter {
  color = "";
  vibrancy: "sidebar" | null = null;
  destroyed = false;
  setBackgroundColor(color: string) {
    this.color = color;
  }
  setVibrancy(value: "sidebar" | null) {
    this.vibrancy = value;
  }
  isDestroyed() {
    return this.destroyed;
  }
}

describe("window material", () => {
  it("enables macOS sidebar sampling and follows activation", () => {
    const material = createWindowMaterial("darwin", new TestTheme());
    expect(material.options("#111111")).toEqual({
      transparent: true,
      backgroundColor: "#00000000",
      vibrancy: "sidebar",
      visualEffectState: "followWindow",
    });
  });
  it("restores the latest opaque color on live accessibility changes and releases its listener", () => {
    const theme = new TestTheme();
    const win = new TestWindow();
    const material = createWindowMaterial("darwin", theme);
    material.setup(win, "#111111");
    material.updateBackground(win, "#eeeeee");
    expect(win.color).toBe("#00000000");
    theme.prefersReducedTransparency = true;
    theme.emit("updated");
    expect(win.color).toBe("#eeeeee");
    expect(win.vibrancy).toBeNull();
    expect(material.options("#eeeeee").vibrancy).toBeUndefined();
    expect(material.options("#eeeeee").backgroundColor).toBe("#eeeeee");
    theme.prefersReducedTransparency = false;
    theme.emit("updated");
    expect(win.color).toBe("#00000000");
    expect(win.vibrancy).toBe("sidebar");
    win.emit("closed");
    expect(theme.listenerCount("updated")).toBe(0);
  });
  for (const platform of ["linux", "win32"]) {
    it(`keeps ${platform} opaque without native listeners`, () => {
      const theme = new TestTheme();
      const win = new TestWindow();
      const material = createWindowMaterial(platform, theme);
      expect(material.options("#112233")).toEqual({ backgroundColor: "#112233" });
      material.setup(win, "#112233");
      material.updateBackground(win, "#445566");
      expect(win.color).toBe("#445566");
      expect(theme.listenerCount("updated")).toBe(0);
      material.applyThemePreference({ themePreference: "dark" });
      expect(theme.themeSource).toBe("system");
    });
  }
  it("sets themeSource from the App's theme preference and keeps vibrancy on", () => {
    const theme = new TestTheme();
    const win = new TestWindow();
    const material = createWindowMaterial("darwin", theme);
    material.setup(win, "#ffffff");
    material.applyThemePreference({ themePreference: "dark", backgroundColor: "#181B1A" });
    expect(theme.themeSource).toBe("dark");
    expect(win.vibrancy).toBe("sidebar");
    material.applyThemePreference({ themePreference: "light" });
    expect(theme.themeSource).toBe("light");
    material.applyThemePreference({ themePreference: "system" });
    expect(theme.themeSource).toBe("system");
    expect(win.vibrancy).toBe("sidebar");
    expect(win.color).toBe("#00000000");
    expect(theme.sources).toEqual(["dark", "light", "system"]);
  });
  it("leaves Auto on the system appearance when the system changes first", () => {
    const theme = new TestTheme();
    const win = new TestWindow();
    const material = createWindowMaterial("darwin", theme);
    material.setup(win, "#ffffff");
    material.applyThemePreference({ themePreference: "system" });
    // The system turns dark; the renderer reports its new background afterwards.
    theme.emit("updated");
    material.updateBackground(win, "#181B1A");
    material.applyThemePreference({ themePreference: "system", backgroundColor: "#181B1A" });
    expect(theme.themeSource).toBe("system");
    expect(theme.sources).toEqual([]);
    expect(win.vibrancy).toBe("sidebar");
  });
  it("ignores payloads without a valid preference", () => {
    const theme = new TestTheme();
    const material = createWindowMaterial("darwin", theme);
    for (const update of [
      undefined,
      null,
      "dark",
      {},
      { backgroundColor: "#000000" },
      { themePreference: "midnight" },
    ]) {
      material.applyThemePreference(update);
    }
    expect(theme.sources).toEqual([]);
  });
});
