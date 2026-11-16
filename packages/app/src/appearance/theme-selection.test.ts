import { expect, test } from "vitest";
import { CODEX_THEME_ID } from "../../../../plugins/codex-theme/shared/palette";
import { resolveThemeSelection } from "./theme-selection";

test("legacy and contributed Codex preferences share the same catalog target and offline fallback", () => {
  expect(resolveThemeSelection({ theme: "codex", pluginThemeId: null })).toEqual({
    requestedId: CODEX_THEME_ID,
    fallbackPreference: "codex",
  });
  expect(resolveThemeSelection({ theme: "plugin", pluginThemeId: CODEX_THEME_ID })).toEqual({
    requestedId: CODEX_THEME_ID,
    fallbackPreference: "codex",
  });
});

test("other contributions and built-in choices retain upstream fallback behavior", () => {
  expect(resolveThemeSelection({ theme: "plugin", pluginThemeId: "other/theme/dark" })).toEqual({
    requestedId: "other/theme/dark",
    fallbackPreference: "auto",
  });
  expect(resolveThemeSelection({ theme: "light", pluginThemeId: CODEX_THEME_ID })).toEqual({
    requestedId: null,
    fallbackPreference: "light",
  });
});
