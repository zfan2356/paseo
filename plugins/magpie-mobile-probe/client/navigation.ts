import type { TurboModule } from "react-native";

export interface NavigationController extends TurboModule {
  shouldStartLoadWithLockIdentifier(allowed: boolean, lockIdentifier: number): void;
}

export interface NavigationRequest {
  url: string;
  lockIdentifier: number;
}

export function answerNavigation(
  controller: NavigationController,
  request: NavigationRequest,
): boolean {
  const allowed = request.url === "about:blank" || request.url.startsWith("about:blank#");
  // Fabric waits for this acknowledgement even when no navigation filter was requested.
  controller.shouldStartLoadWithLockIdentifier(allowed, request.lockIdentifier);
  return allowed;
}
