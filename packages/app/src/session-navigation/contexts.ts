import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useReplicaQueries } from "@/data/query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { SessionContext } from "@getpaseo/protocol/session-context";
export type ContextSnapshot =
  | { status: "ready"; context: SessionContext }
  | { status: "error"; message: string };
export function contextKey(serverId: string, agentId: string) {
  return ["session-navigation-context", serverId, agentId];
}
export interface ContextTarget {
  serverId: string;
  agentId: string;
  client: DaemonClient | null;
  enabled: boolean;
}
export function useSessionContexts(targets: ContextTarget[]) {
  const cache = useQueryClient();
  const queries = useReplicaQueries<ContextSnapshot>(
    targets.map((target) => ({
      queryKey: contextKey(target.serverId, target.agentId),
      enabled: false,
      pushEvent: "agent.context.update",
    })),
  );
  useEffect(() => {
    const controller = new AbortController();
    const observations = targets
      .filter((target) => target.enabled && target.client)
      .map((target) => {
        const key = contextKey(target.serverId, target.agentId);
        const publish = (context: SessionContext) => {
          if (!controller.signal.aborted)
            cache.setQueryData<ContextSnapshot>(key, { status: "ready", context });
        };
        const fail = (error: unknown) => {
          if (!controller.signal.aborted)
            cache.setQueryData<ContextSnapshot>(key, {
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            });
        };
        if (!target.client) throw new Error("Context observation requires a connected client");
        const observation = target.client.observeSessionContext(target.agentId, {
          signal: controller.signal,
        });
        observation.subscribe({
          snapshot: (snapshot) => publish(snapshot.context),
          update: (message) => {
            if (message.type === "agent.context.update") publish(message.payload.context);
          },
          error: fail,
        });
        void observation.ready.then((snapshot) => publish(snapshot.context)).catch(fail);
        return observation;
      });
    return () => {
      controller.abort();
      for (const observation of observations) void observation.release();
    };
  }, [targets, cache]);
  return useMemo(
    () =>
      new Map(
        targets.map((target, index) => [
          `${target.serverId}:${target.agentId}`,
          queries[index].data,
        ]),
      ),
    [targets, queries],
  );
}
