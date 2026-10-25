import { expect, test } from "vitest";
import { answerNavigation, type NavigationController } from "./navigation.js";

test.each([
  ["about:blank", true],
  ["about:blank#probe", true],
  ["https://example.com/", false],
  ["about:blank.evil", false],
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
