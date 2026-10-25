import { expect, test } from "vitest";
import { mobileOrigin } from "../shared/mobile.js";
import { answerNavigation, type NavigationController } from "./native-navigation.js";

test.each([
  ["about:blank", true],
  ["about:blank#settings", true],
  [mobileOrigin + "/", true],
  [mobileOrigin + "/?view=settings&tab=general", true],
  [mobileOrigin + "/#providers", true],
  [mobileOrigin + "/api/providers", false],
  [mobileOrigin + ".example.com/", false],
  ["https://example.com/", false],
])("answers the native navigation lock for %s", (url, allowed) => {
  const decisions: Array<readonly [boolean, number]> = [];
  const controller: NavigationController = {
    shouldStartLoadWithLockIdentifier(allow, lock) {
      decisions.push([allow, lock]);
    },
  };
  expect(answerNavigation(controller, { url, lockIdentifier: 42 })).toBe(allowed);
  expect(decisions).toEqual([[allowed, 42]]);
});
