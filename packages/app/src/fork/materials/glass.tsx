import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";

// iOS and web keep upstream rendering. Android glass lives in glass.android.tsx; each export there
// renders exactly what these render whenever blur is unavailable.

/** Wraps the app below the sheet portal host so sheets can blur it. */
export function GlassAppTarget({ children }: { children: ReactNode }) {
  return children;
}

/** A plain view that owns one blur target for the glass inside it. */
export function GlassScope(props: ViewProps) {
  return <View {...props} />;
}

/** The content a floating glass surface in the same scope blurs. */
export function GlassTarget(props: ViewProps) {
  return <View {...props} />;
}

/** Renders the upstream fade unless Android glass replaces it. */
export function GlassFade({ children }: { children: ReactNode }) {
  return children;
}

/** Glass behind a floating header; nothing outside Android. */
export function GlassHeaderFill() {
  return null;
}

/** Glass fill for a bottom sheet background; nothing outside Android. */
export function GlassSheetFill() {
  return null;
}
