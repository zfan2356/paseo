import type { BottomSheetBackgroundProps } from "@gorhom/bottom-sheet";
import { StyleSheet, View } from "react-native";
import { MATERIAL_SLOTS } from "@/styles/material-slots";

// Match Gorhom's default background outside the opt-in study. Callers' backgroundStyle
// still wins; the marker lets default sheets participate alongside custom backgrounds.
const styles = StyleSheet.create({ background: { backgroundColor: "white", borderRadius: 15 } });
export function materialSheetBackground({ pointerEvents, style }: BottomSheetBackgroundProps) {
  return (
    <View
      pointerEvents={pointerEvents}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Bottom Sheet"
      dataSet={MATERIAL_SLOTS.sheet}
      style={[styles.background, style]}
    />
  );
}
