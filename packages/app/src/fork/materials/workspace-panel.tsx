import type { ReactNode } from "react";
import { View } from "react-native";

// Native keeps the upstream full-screen workspace.
export function WorkspacePanel({ children }: { children: ReactNode; floating: boolean }) {
  return <View style={FILL}>{children}</View>;
}

const FILL = { flex: 1 } as const;
