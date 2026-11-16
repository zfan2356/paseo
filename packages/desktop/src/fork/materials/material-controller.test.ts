import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createWindowMaterial, isDarkColor } from "./material-controller";

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
class TestSystem {
  dark = false;
  listeners: (() => void)[] = [];
  isDark = () => this.dark;
  onChange = (callback: () => void) => {
    this.listeners.push(callback);
  };
  set(dark: boolean) {
    this.dark = dark;
    for (const listener of this.listeners) listener();
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
    const material = createWindowMaterial("darwin", new TestTheme(), new TestSystem());
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
    const material = createWindowMaterial("darwin", theme, new TestSystem());
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
      const material = createWindowMaterial(platform, theme, new TestSystem());
      expect(material.options("#112233")).toEqual({ backgroundColor: "#112233" });
      material.setup(win, "#112233");
      material.updateBackground(win, "#445566");
      expect(win.color).toBe("#445566");
      expect(theme.listenerCount("updated")).toBe(0);
      expect(theme.themeSource).toBe("system");
    });
  }
  it("pins vibrancy to the App theme only while it differs from the system appearance", () => {
    const theme = new TestTheme();
    const system = new TestSystem();
    const win = new TestWindow();
    const material = createWindowMaterial("darwin", theme, system);
    material.setup(win, "#ffffff");
    material.updateBackground(win, "#181B1A");
    expect(theme.themeSource).toBe("dark");
    system.set(true);
    expect(theme.themeSource).toBe("system");
    material.updateBackground(win, "#ffffff");
    expect(theme.themeSource).toBe("light");
    system.set(false);
    expect(theme.themeSource).toBe("system");
    expect(theme.sources).toEqual(["dark", "system", "light", "system"]);
  });
  it("classifies theme backgrounds", () => {
    expect(isDarkColor("#181B1A")).toBe(true);
    expect(isDarkColor("#000000")).toBe(true);
    expect(isDarkColor("#ffffff")).toBe(false);
    expect(isDarkColor("#f7f9f6")).toBe(false);
    expect(isDarkColor("rgb(24, 27, 26)")).toBe(true);
    expect(isDarkColor("rgba(250, 250, 250, 1)")).toBe(false);
    expect(isDarkColor("oklch(0.2 0 0)")).toBeNull();
  });
});
