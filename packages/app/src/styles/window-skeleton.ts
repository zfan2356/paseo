// Native layouts have no window skeleton; the preview switch is web and desktop only.
export type WindowSkeleton = "a" | "b";

export function useWindowSkeleton(): WindowSkeleton {
  return "a";
}

export function setWindowSkeleton(_skeleton: WindowSkeleton): void {}
