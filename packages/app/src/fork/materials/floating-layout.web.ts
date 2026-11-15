import type { LayoutChangeEvent } from "react-native";
import { MATERIAL_SLOTS } from "./slots";

// Agent tabs float the workspace chrome and composer over the transcript. Each publishes
// its height on its parent so the transcript reserves that space and nothing is covered.
export function workspaceChromeSlot(activeTab: { kind: string } | null | undefined) {
  return activeTab?.kind === "agent" ? MATERIAL_SLOTS.chrome : MATERIAL_SLOTS.chromeStatic;
}

function publishParentHeight(event: LayoutChangeEvent, property: string): void {
  // react-native-web exposes the measured element as nativeEvent.target.
  const target = (event.nativeEvent as unknown as { target?: unknown }).target;
  if (target instanceof HTMLElement) {
    target.parentElement?.style.setProperty(property, `${event.nativeEvent.layout.height}px`);
  }
}

export function publishChromeClearance(event: LayoutChangeEvent): void {
  publishParentHeight(event, "--paseo-chrome-clearance");
}

export function publishComposerClearance(event: LayoutChangeEvent): void {
  publishParentHeight(event, "--paseo-composer-clearance");
}
