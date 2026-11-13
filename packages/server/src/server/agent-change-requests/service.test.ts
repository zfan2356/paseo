import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentStorage } from "../agent/agent-storage.js";
import type { AgentManager, AgentSubscriber } from "../agent/agent-manager.js";
import { AgentChangeRequests } from "./service.js";
import { createForgeResolver } from "../../services/forge-resolver.js";
import { createTgitService } from "../../services/tgit-service.js";
import { ForgeAuthenticationError, ForgeCommandError } from "../../services/forge-cli-command.js";
import type { AgentChangeRequestsSnapshot } from "@getpaseo/protocol/messages";
import type { AgentPromptInput } from "../agent/agent-sdk-types.js";

const url = "https://git.woa.com/example/repo/merge_requests/686";
const status = {
  number: 686,
  projectPath: "example/repo",
  url,
  title: "Title",
  state: "open",
  baseRefName: "main",
  headRefName: "unrelated",
  isMerged: false,
  mergeable: "UNKNOWN" as const,
  checks: [],
  checksStatus: "none" as const,
  reviewDecision: null,
};
let dir: string;
let storage: AgentStorage;
let service: AgentChangeRequests;
let read: ReturnType<typeof vi.fn<() => Promise<typeof status>>>;
let prompt: (agentId: string, input: AgentPromptInput) => void;
let event: AgentSubscriber;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "paseo-linked-mrs-"));
  storage = new AgentStorage(dir, createTestLogger());
  await storage.upsert({
    id: "a",
    provider: "codex",
    cwd: "/another/checkout",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    labels: {},
    lastStatus: "idle",
  });
  read = vi.fn(async () => status);
  const adapter = { ...createTgitService(), getPullRequestStatus: read };
  service = new AgentChangeRequests(
    storage,
    createForgeResolver({ createService: () => adapter, probeForge: async () => null }),
    createTestLogger(),
    { resolveRemoteUrl: async () => "git@git.woa.com:example/repo.git", cwd: dir },
  );
  const manager: Pick<AgentManager, "subscribe" | "subscribeSubmittedPrompts"> = {
    subscribe: (handler) => {
      event = handler;
      return () => {};
    },
    subscribeSubmittedPrompts: (handler) => {
      prompt = handler;
      return () => {};
    },
  };
  service.attach(manager);
});
afterEach(async () => {
  await service.dispose();
  await rm(dir, { recursive: true, force: true });
  vi.useRealTimers();
});
const attachment = {
  type: "forge_change_request" as const,
  forge: "tgit",
  number: 686,
  url,
  title: "Title",
  projectPath: "example/repo",
  baseRefName: "main",
  headRefName: "branch",
};

function created(fromHistory = false) {
  event({
    type: "agent_stream",
    fromHistory,
    agentId: "a",
    event: {
      type: "timeline",
      provider: "codex",
      item: {
        type: "tool_call",
        callId: "call-1",
        name: "shell",
        status: "completed",
        error: null,
        detail: {
          type: "shell",
          command: "gw mr create --json",
          exitCode: 0,
          output: JSON.stringify({ iid: 686, web_url: url }),
        },
      },
    },
  });
}

describe("session linked change requests", () => {
  it("persists concurrent deduplicated adds, restores old defaults and retains exclusion keys", async () => {
    expect(await service.list("a")).toEqual({ agentId: "a", autoLink: true, items: [] });
    await Promise.all([
      service.update("a", { addUrl: url }),
      service.update("a", { addUrl: url.replace("/merge_requests", "/-/merge_requests") }),
      service.update("a", { addUrl: url + "?tab=changes#note_9" }),
    ]);
    const snapshot = await service.list("a");
    expect(snapshot.items).toHaveLength(1);
    const restored = new AgentStorage(dir, createTestLogger());
    expect((await restored.get("a"))?.linkedChangeRequests).toHaveLength(1);
    await service.update("a", { removeKey: snapshot.items[0].reference.key });
    created();
    prompt("a", [attachment]);
    await service.dispose();
    expect((await storage.get("a"))?.linkedChangeRequests).toEqual([]);
    expect((await storage.get("a"))?.excludedChangeRequestKeys).toContain(
      snapshot.items[0].reference.key,
    );
    await service.update("a", { addUrl: url });
    expect((await storage.get("a"))?.excludedChangeRequestKeys).toEqual([]);
  });
  it("collects accepted attachments and completed create calls but never rescans disabled history", async () => {
    await service.update("a", { autoLink: false });
    created();
    prompt("a", [attachment]);
    await vi.waitFor(() => expect(read).not.toHaveBeenCalled());
    expect((await service.list("a")).items).toEqual([]);
    await service.update("a", { autoLink: true });
    created(true);
    await vi.waitFor(async () => expect((await service.list("a")).items).toEqual([]));
    created();
    await vi.waitFor(async () => expect((await service.list("a")).items).toHaveLength(1));
    expect((await service.list("a")).items[0].reference).toMatchObject({
      source: "tool",
      callId: "call-1",
    });
    const key = (await service.list("a")).items[0].reference.key;
    await service.update("a", { removeKey: key });
    await service.update("a", { addUrl: url });
    expect((await service.list("a")).items[0].reference.source).toBe("manual");
  });
  it("uses submitted attachment identity, rejecting mismatched metadata", async () => {
    prompt("a", [{ ...attachment, number: 7 }]);
    await service.dispose();
    expect((await storage.get("a"))?.linkedChangeRequests).toBeUndefined();
  });
  it("shares a single poll across subscribers and sessions and stops after the final release", async () => {
    await service.update("a", { addUrl: url });
    await storage.upsert({ ...(await storage.get("a"))!, id: "b", cwd: "/second/checkout" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const snapshots: AgentChangeRequestsSnapshot[] = [];
    const a = await service.subscribe("a", (snapshot) => snapshots.push(snapshot));
    const b = await service.subscribe("b", () => {});
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(read.mock.calls[0]).toEqual([
      { cwd: dir, host: "git.woa.com", projectPath: "example/repo", number: 686 },
    ]);
    await vi.waitFor(() => expect(snapshots.at(-1)?.items[0].availability).toBe("available"));
    a();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(read).toHaveBeenCalledTimes(2);
    b();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("keeps the last status on auth failure and backs off until a later successful refresh", async () => {
    await service.update("a", { addUrl: url });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stop = await service.subscribe("a", () => {});
    await vi.waitFor(async () =>
      expect((await service.list("a")).items[0].availability).toBe("available"),
    );
    read.mockRejectedValueOnce(new ForgeAuthenticationError("sign in", { stderr: "" }));
    await vi.advanceTimersByTimeAsync(45_000);
    expect((await service.list("a")).items[0]).toMatchObject({
      availability: "unauthenticated",
      stale: true,
      status: { title: "Title" },
    });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await service.list("a")).items[0].stale).toBe(false);
    stop();
  });
  it("does not probe an arbitrary unauthenticated self-hosted URL", async () => {
    const probe = vi.fn(async () => null);
    const bounded = new AgentChangeRequests(
      storage,
      createForgeResolver({ probeForge: probe }),
      createTestLogger(),
    );
    await expect(
      bounded.update("a", { addUrl: "https://untrusted.test/team/repo/pull/1" }),
    ).rejects.toThrow("sign in");
    expect(probe).toHaveBeenCalledWith("untrusted.test");
    await bounded.dispose();
  });
});

it("collects a valid submitted attachment after an unsupported one", async () => {
  prompt("a", [{ ...attachment, url: "https://unknown.test/owner/repo/pull/1" }, attachment]);
  await vi.waitFor(async () => expect((await service.list("a")).items).toHaveLength(1));
  expect((await service.list("a")).items[0].reference.source).toBe("attachment");
});

it("releases polling when the agent is removed", async () => {
  await service.update("a", { addUrl: url });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const receive = vi.fn();
  const stop = await service.subscribe("a", receive);
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  event({ type: "agent_removed", agentId: "a", internal: false });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(read).toHaveBeenCalledOnce();
  expect(receive).toHaveBeenLastCalledWith({ agentId: "a", autoLink: true, items: [] });
  stop();
});

it.each([
  ["HTTP 404: Not Found", "not_found"],
  ["HTTP 403: Forbidden", "forbidden"],
])("classifies CLI read failure %s", async (stderr, availability) => {
  await service.update("a", { addUrl: url });
  read.mockRejectedValueOnce(
    new ForgeCommandError(
      { brand: "GitLab", binary: "glab" },
      { args: [], cwd: "/repo", exitCode: 1, stderr },
    ),
  );
  const stop = await service.subscribe("a", () => {});
  await vi.waitFor(async () =>
    expect((await service.list("a")).items[0]).toMatchObject({
      availability,
      status: null,
      stale: true,
    }),
  );
  stop();
});
