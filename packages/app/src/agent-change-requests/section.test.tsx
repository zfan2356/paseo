/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AgentChangeRequestsSnapshot } from "@getpaseo/client";
import { ChangeRequestsView } from "./section";
import { openChangeRequests } from "./model";

vi.mock("react-native-reanimated", async (original) => {
  const actual = await original<typeof import("react-native-reanimated")>();
  return {
    ...actual,
    interpolateColor: () => "#000000",
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useDerivedValue: (factory: () => unknown) => ({ value: factory() }),
    withTiming: (value: unknown) => value,
  };
});
const toggle = () => {};

beforeEach(() => vi.stubGlobal("React", React));
it("renders repository status and dispatches add/remove through the form", async () => {
  const reference = {
    key: "one",
    forge: "tgit",
    host: "git.woa.com",
    projectPath: "group/repo",
    number: 7,
    url: "https://git.woa.com/group/repo/merge_requests/7",
    source: "manual" as const,
    addedAt: "2026-11-13T00:00:00Z",
  };
  const snapshot: AgentChangeRequestsSnapshot = {
    agentId: "a",
    autoLink: true,
    items: [
      {
        reference,
        availability: "available",
        stale: false,
        refreshedAt: "2026-11-13T00:00:00Z",
        status: {
          forge: "tgit",
          url: reference.url,
          title: "Cross repository MR",
          state: "open",
          baseRefName: "main",
          headRefName: "feature",
          isMerged: false,
          isDraft: false,
          mergeable: "MERGEABLE",
          checks: [],
          checksStatus: "success",
          reviewDecision: "approved",
        },
      },
    ],
  };
  const update = vi.fn(async () => snapshot);
  const model = openChangeRequests({
    read: {
      list: async () => snapshot,
      subscribe: (listener) => {
        listener(snapshot);
        return () => {};
      },
    },
    update,
  });
  model.start();
  const view = render(
    <ChangeRequestsView model={model} expanded label="Linked PRs/MRs" toggle={toggle} />,
  );
  expect(screen.getByText("Cross repository MR")).toBeTruthy();
  expect(screen.getByText(/CI: success/).textContent).toContain("MERGEABLE");
  expect(screen.getByText("group/repo !7")).toBeTruthy();
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "https://github.com/other/repo/pull/9" } });
  await act(async () => {
    fireEvent.click(screen.getByTestId("agent-change-requests-add"));
  });
  expect(update).toHaveBeenLastCalledWith({ addUrl: "https://github.com/other/repo/pull/9" });
  await act(async () => {
    fireEvent.click(screen.getByLabelText(/group\/repo !7/));
  });
  expect(update).toHaveBeenLastCalledWith({ removeKey: "one" });
  model.close();
  view.unmount();
});
