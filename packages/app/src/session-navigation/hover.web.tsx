import { useCallback, type ReactNode } from "react";
export function SessionRowHover({
  children,
  onHoverChange,
}: {
  children: ReactNode;
  onHoverChange(hovered: boolean): void;
}) {
  const enter = useCallback(() => onHoverChange(true), [onHoverChange]);
  const leave = useCallback(() => onHoverChange(false), [onHoverChange]);
  return (
    <div onMouseEnter={enter} onMouseLeave={leave}>
      {children}
    </div>
  );
}
