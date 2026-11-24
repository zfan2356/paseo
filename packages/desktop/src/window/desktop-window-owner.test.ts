import { describe, expect, it } from "vitest";
import { createDesktopWindowOwner, type OwnedDesktopWindow } from "./desktop-window-owner.js";

interface Target {
  id: string;
}

function harness() {
  const windows: OwnedDesktopWindow<Target>[] = [];
  const launches: Array<{ initialRoute: string | null; restoreWindowState: boolean }> = [];
  const sent: Target[] = [];
  const windowActions: string[] = [];
  let nextId = 1;
  let focused: OwnedDesktopWindow<Target> | null = null;
  let closeWindow = (_id: number) => {};
  const owner = createDesktopWindowOwner<Target>({
    async create(input) {
      launches.push({
        initialRoute: input.initialRoute,
        restoreWindowState: input.restoreWindowState,
      });
      const id = nextId++;
      closeWindow = input.onClosed;
      const window: OwnedDesktopWindow<Target> = {
        webContentsId: id,
        isDestroyed: () => false,
        isVisible: () => true,
        isMinimized: () => false,
        restore: () => {
          windowActions.push(`restore:${id}`);
        },
        show: () => {
          windowActions.push(`show:${id}`);
        },
        focus: () => {
          windowActions.push(`focus:${id}`);
        },
        sendAgent: (target) => sent.push(target),
      };
      windows.push(window);
      input.onCreated(id);
      return window;
    },
    windows: () => windows,
    focusedWindow: () => focused,
    agentRoute: (target) => `/agent/${target.id}`,
    deliverAgent: (_id, target) => target,
  });
  return {
    owner,
    launches,
    sent,
    windows,
    windowActions,
    setFocused: (window: OwnedDesktopWindow<Target>) => {
      focused = window;
    },
    close: (id: number) => closeWindow(id),
  };
}

describe("desktop window owner", () => {
  it("restores only primary launches and routes pending projects per window", async () => {
    const h = harness();
    await h.owner.openPrimary({ pendingProjectPath: " /project/a " });
    await h.owner.openAdditional({ pendingProjectPath: "/project/b" });
    expect(h.launches).toEqual([
      { initialRoute: null, restoreWindowState: true },
      { initialRoute: null, restoreWindowState: false },
    ]);
    expect(h.owner.takePendingProject(1)).toBe("/project/a");
    expect(h.owner.takePendingProject(2)).toBe("/project/b");
  });

  it("focuses an existing window and delivers agent routing through its inbox", async () => {
    const h = harness();
    await h.owner.openPrimary();
    h.setFocused(h.windows[0]);
    await h.owner.openOrFocusAgent({ id: "agent-7" });
    expect(h.launches).toHaveLength(1);
    expect(h.sent).toEqual([{ id: "agent-7" }]);
  });

  it("removes pending routing state when a window closes", async () => {
    const h = harness();
    await h.owner.openAdditional({ pendingProjectPath: "/project/a" });
    h.close(1);
    expect(h.owner.takePendingProject(1)).toBeNull();
  });

  it("restores and focuses a minimized window without opening another", async () => {
    const h = harness();
    await h.owner.openPrimary();
    h.windows[0].isMinimized = () => true;
    await h.owner.restoreWhenActivated();
    expect(h.windowActions).toEqual(["restore:1", "show:1", "focus:1"]);
    expect(h.launches).toHaveLength(1);
  });

  it("shows the focused window rather than an unrelated window", async () => {
    const h = harness();
    await h.owner.openPrimary();
    await h.owner.openAdditional();
    h.setFocused(h.windows[1]);
    await h.owner.restoreWhenActivated();
    expect(h.windowActions).toEqual(["show:2", "focus:2"]);
    expect(h.launches).toHaveLength(2);
  });

  it("shows a hidden window", async () => {
    const h = harness();
    await h.owner.openPrimary();
    h.windows[0].isVisible = () => false;
    await h.owner.restoreWhenActivated();
    expect(h.windowActions).toEqual(["show:1", "focus:1"]);
    expect(h.launches).toHaveLength(1);
  });

  it("opens a primary window when activated without any windows", async () => {
    const h = harness();
    await h.owner.restoreWhenActivated();
    expect(h.launches).toEqual([{ initialRoute: null, restoreWindowState: true }]);
  });
});
