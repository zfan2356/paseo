import type { AgentChangeRequestsSnapshot } from "@getpaseo/client";

export interface SessionGitTarget {
  workspaceKey: string;
  agentId: string;
  serverId: string;
}
export interface SessionGitPort {
  observe(
    target: SessionGitTarget,
    update: (snapshot: AgentChangeRequestsSnapshot) => void,
    error: () => void,
  ): () => void;
  schedule(callback: () => void, delay: number): () => void;
}

export function createSessionGitObserver(
  port: SessionGitPort,
  publish: (key: string, snapshot: AgentChangeRequestsSnapshot | undefined) => void,
) {
  let desired = new Map<string, SessionGitTarget>();
  const running = new Map<string, { target: SessionGitTarget; stop: () => void }>();
  const attempts = new Map<string, number>();
  let cancelRetry: (() => void) | undefined;
  let closed = false;
  function reconcile() {
    if (closed) return;
    for (const [key, held] of running) {
      const target = desired.get(key);
      if (
        target &&
        target.agentId === held.target.agentId &&
        target.serverId === held.target.serverId
      )
        continue;
      held.stop();
      running.delete(key);
      attempts.delete(key);
      publish(key, undefined);
    }
    for (const [key, target] of desired) {
      if (running.has(key) || (attempts.has(key) && cancelRetry)) continue;
      let live = true;
      const stop = port.observe(
        target,
        (snapshot) => {
          if (live) {
            attempts.delete(key);
            publish(key, snapshot);
          }
        },
        () => {
          if (!live || closed) return;
          live = false;
          queueMicrotask(() => {
            const held = running.get(key);
            if (!held || held.target !== target || closed) return;
            held.stop();
            running.delete(key);
            const count = Math.min((attempts.get(key) ?? 0) + 1, 6);
            attempts.set(key, count);
            publish(key, undefined);
            if (!cancelRetry)
              cancelRetry = port.schedule(
                () => {
                  cancelRetry = undefined;
                  reconcile();
                },
                Math.min(1000 * 2 ** (count - 1), 30000),
              );
          });
        },
      );
      running.set(key, {
        target,
        stop: () => {
          live = false;
          stop();
        },
      });
    }
  }
  return {
    setTargets(targets: readonly SessionGitTarget[]) {
      const next = new Map(targets.map((target) => [target.workspaceKey, target]));
      for (const key of attempts.keys()) {
        const before = desired.get(key);
        const after = next.get(key);
        if (!after || before?.agentId !== after.agentId || before.serverId !== after.serverId)
          attempts.delete(key);
      }
      desired = next;
      reconcile();
    },
    close() {
      closed = true;
      cancelRetry?.();
      for (const item of running.values()) item.stop();
      running.clear();
    },
  };
}

export interface DirectoryValidationPort {
  refresh(serverId: string, epoch: string): Promise<boolean>;
  schedule(callback: () => void, delay: number): () => void;
}

export function validateSessionDirectories(
  targets: ReadonlyMap<string, string>,
  port: DirectoryValidationPort,
  publish: (completed: ReadonlyMap<string, string>) => void,
): () => void {
  const pending = new Map(targets);
  let live = true;
  let cancel: (() => void) | undefined;
  let attempt = 0;
  async function refresh() {
    const results = await Promise.all(
      [...pending].map(async ([serverId, epoch]) => {
        try {
          return { serverId, epoch, ready: await port.refresh(serverId, epoch) };
        } catch {
          return { serverId, epoch, ready: false };
        }
      }),
    );
    if (!live) return;
    const completed = new Map<string, string>();
    for (const result of results) {
      if (!result.ready) continue;
      pending.delete(result.serverId);
      completed.set(result.serverId, result.epoch);
    }
    if (completed.size) publish(completed);
    if (pending.size) {
      const delay = Math.min(1000 * 2 ** attempt, 30000);
      attempt = Math.min(attempt + 1, 5);
      cancel = port.schedule(() => {
        void refresh();
      }, delay);
    }
  }
  void refresh();
  return () => {
    live = false;
    cancel?.();
  };
}

export function sessionGitConnection(
  snapshot: {
    connectionStatus: string;
    clientGeneration: number;
    connectionEpoch: number;
    client: { supportsAgentChangeRequests(): boolean } | null;
  } | null,
): string | null {
  if (snapshot?.connectionStatus !== "online" || !snapshot.client?.supportsAgentChangeRequests())
    return null;
  return `${snapshot.clientGeneration}:${snapshot.connectionEpoch}`;
}

export function eligibleSessionGitTargets(
  targets: readonly SessionGitTarget[],
  active: boolean,
  source: "path" | "session",
  readyHosts: ReadonlySet<string>,
): SessionGitTarget[] {
  if (!active || source !== "session") return [];
  return targets.filter((target) => readyHosts.has(target.serverId));
}
