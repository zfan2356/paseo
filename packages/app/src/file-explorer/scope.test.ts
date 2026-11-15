import { expect, it } from "vitest";
import { buildWorkspaceExplorerStateKey } from "./scope";
it("isolates directory listings and browsing state by session and path while preserving legacy keys", () => {
  const first = buildWorkspaceExplorerStateKey({
    workspaceId: "shared",
    workspaceRoot: "/a",
    sessionAgentId: "one",
  });
  expect(first).not.toBe(
    buildWorkspaceExplorerStateKey({
      serverId: "other",
      workspaceId: "shared",
      workspaceRoot: "/a",
      sessionAgentId: "one",
    }),
  );
  expect(first).not.toBe(
    buildWorkspaceExplorerStateKey({
      workspaceId: "shared",
      workspaceRoot: "/b",
      sessionAgentId: "one",
    }),
  );
  expect(first).not.toBe(
    buildWorkspaceExplorerStateKey({
      workspaceId: "shared",
      workspaceRoot: "/a",
      sessionAgentId: "two",
    }),
  );
  expect(buildWorkspaceExplorerStateKey({ workspaceId: "shared", workspaceRoot: "/a" })).toBe(
    "workspace:shared",
  );
});
