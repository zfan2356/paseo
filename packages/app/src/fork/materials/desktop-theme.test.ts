import { describe, expect, it } from "vitest";
import { resolveDesktopThemePreference } from "./desktop-theme";

describe("desktop theme preference", () => {
  it("maps Auto to the system appearance", () => {
    expect(resolveDesktopThemePreference({ adaptive: true, colorScheme: "light" })).toBe("system");
    expect(resolveDesktopThemePreference({ adaptive: true, colorScheme: "dark" })).toBe("system");
  });
  it("pins a chosen theme, built-in or plugin, to its scheme", () => {
    expect(resolveDesktopThemePreference({ adaptive: false, colorScheme: "light" })).toBe("light");
    expect(resolveDesktopThemePreference({ adaptive: false, colorScheme: "dark" })).toBe("dark");
  });
});
