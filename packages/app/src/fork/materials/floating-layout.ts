import type { LayoutChangeEvent } from "react-native";
import { MATERIAL_SLOTS } from "./slots";

// Native layouts do not float chrome or the composer over the transcript.
export function workspaceChromeSlot(_activeTab: { kind: string } | null | undefined) {
  return MATERIAL_SLOTS.chromeStatic;
}
export function publishChromeClearance(_event: LayoutChangeEvent): void {}
export function publishComposerClearance(_event: LayoutChangeEvent): void {}
