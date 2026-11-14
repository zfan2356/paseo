import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createWindowMaterial } from "./material-controller";

class TestTheme extends EventEmitter {
  prefersReducedTransparency = false;
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
    });
  }
});
