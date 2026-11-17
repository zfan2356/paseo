import type { TurboModule } from "react-native";
import { mobileOrigin } from "../shared/mobile.js";

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
  const allowed =
    request.url === "about:blank" ||
    request.url.startsWith("about:blank#") ||
    request.url === mobileOrigin + "/" ||
    request.url.startsWith(mobileOrigin + "/?") ||
    request.url.startsWith(mobileOrigin + "/#");
  controller.shouldStartLoadWithLockIdentifier(allowed, request.lockIdentifier);
  return allowed;
}
