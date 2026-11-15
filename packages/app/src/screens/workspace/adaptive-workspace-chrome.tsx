import type { WorkspaceTabDescriptor } from "./workspace-tabs-types";
import { isWeb } from "@/constants/platform";
import { MATERIAL_SLOTS } from "@/styles/material-slots";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { selectWorkspaceChrome } from "./workspace-tab-layout";
import { WorkspaceTabMeasurementScope } from "./workspace-desktop-tabs-row";

export function AdaptiveWorkspaceChrome({
  compactHeader,
  activeTab,
  children,
}: {
  compactHeader: ReactNode;
  activeTab: WorkspaceTabDescriptor | null;
  children: ReactNode;
}) {
  const chromeRef = useRef<View>(null);
  const [width, setWidth] = useState<number | null>(null);
  const measure = useCallback((event: LayoutChangeEvent) => {
    if (isWeb && chromeRef.current instanceof HTMLElement) {
      chromeRef.current.parentElement?.style.setProperty(
        "--paseo-chrome-clearance",
        event.nativeEvent.layout.height + "px",
      );
    }
    const measured = event.nativeEvent.layout.width;
    if (measured > 0) setWidth(measured);
  }, []);
  return (
    <WorkspaceTabMeasurementScope>
      <View
        ref={chromeRef}
        dataSet={
          isWeb && activeTab?.kind === "agent" ? MATERIAL_SLOTS.chrome : MATERIAL_SLOTS.chromeStatic
        }
        onLayout={measure}
      >
        {selectWorkspaceChrome({ width, compact: compactHeader, full: children })}
      </View>
    </WorkspaceTabMeasurementScope>
  );
}

export interface WorkspaceCompactHeaderActions {
  pane?: {
    id: string;
    splitRight?: () => void;
    splitDown?: () => void;
    toggleMaximized?: () => void;
    maximized: boolean;
  };
  closeAbove: (key: string) => Promise<void> | void;
  closeBelow: (key: string) => Promise<void> | void;
  closeOthers: (key: string) => Promise<void> | void;
}
