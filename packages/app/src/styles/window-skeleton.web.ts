import { useSyncExternalStore } from "react";

// Preview switch between the two window skeletons in docs/design.md §14. Remove once one is chosen.
export type WindowSkeleton = "a" | "b";

const STORAGE_KEY = "@paseo:window-skeleton-preview";
const listeners = new Set<() => void>();

function read(): WindowSkeleton {
  return localStorage.getItem(STORAGE_KEY) === "b" ? "b" : "a";
}

let current: WindowSkeleton = read();
document.documentElement.dataset.skeleton = current;

export function setWindowSkeleton(skeleton: WindowSkeleton): void {
  current = skeleton;
  localStorage.setItem(STORAGE_KEY, skeleton);
  document.documentElement.dataset.skeleton = skeleton;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWindowSkeleton(): WindowSkeleton {
  return useSyncExternalStore(subscribe, () => current);
}
