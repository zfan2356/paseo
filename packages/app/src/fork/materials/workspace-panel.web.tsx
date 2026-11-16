import type { ReactNode } from "react";
import { View } from "react-native";
import { MATERIAL_SLOTS } from "./slots";

// Both views always render, so toggling focus mode or the sidebar never remounts the workspace.
export function WorkspacePanel({ children, floating }: { children: ReactNode; floating: boolean }) {
  return (
    <View style={FILL} dataSet={floating ? MATERIAL_SLOTS.panelFrame : undefined}>
      <View style={FILL} dataSet={floating ? MATERIAL_SLOTS.panel : undefined}>
        {children}
      </View>
    </View>
  );
}

const FILL = { flex: 1 } as const;
