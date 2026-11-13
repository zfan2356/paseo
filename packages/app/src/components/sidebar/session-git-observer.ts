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
  schedule(callback: () => void): () => void;
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
      if (running.has(key) || (attempts.get(key) ?? 0) >= 3) continue;
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
            attempts.set(key, (attempts.get(key) ?? 0) + 1);
            publish(key, undefined);
            if (!cancelRetry)
              cancelRetry = port.schedule(() => {
                cancelRetry = undefined;
                reconcile();
              });
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
