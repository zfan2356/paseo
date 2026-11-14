import type { ReactNode } from "react";
import { View } from "react-native";
export function SessionRowHover({
  children,
}: {
  children: ReactNode;
  onHoverChange(hovered: boolean): void;
}) {
  return <View>{children}</View>;
}
