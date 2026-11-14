import type { AgentChangeRequestsSnapshot, PaseoAgentChangeRequestsHandle } from "@getpaseo/client";

interface Ports {
  read: PaseoAgentChangeRequestsHandle;
  update(options: {
    addUrl?: string;
    removeKey?: string;
    autoLink?: boolean;
  }): Promise<AgentChangeRequestsSnapshot>;
}
interface State {
  snapshot: AgentChangeRequestsSnapshot | null;
  busy: boolean;
  error: string | null;
  url: string;
  inputRevision: number;
}

export function openChangeRequests(ports: Ports) {
  let state: State = { snapshot: null, busy: false, error: null, url: "", inputRevision: 0 };
  let closed = false;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: Partial<State>) => {
    if (closed) return;
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const mutate = async (options: { addUrl?: string; removeKey?: string; autoLink?: boolean }) => {
    if (closed || state.busy || !state.snapshot) return;
    publish({ busy: true, error: null });
    try {
      await ports.update(options);
      if (options.addUrl) publish({ url: "", inputRevision: state.inputRevision + 1 });
    } catch (error) {
      publish({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      publish({ busy: false });
    }
  };
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      if (closed || stop) return;
      stop = ports.read.subscribe((snapshot) => publish({ snapshot, error: null }), {
        onError: (error) =>
          publish({ error: error instanceof Error ? error.message : String(error) }),
      });
    },
    close: () => {
      closed = true;
      stop?.();
      listeners.clear();
    },
    setUrl: (url: string) => publish({ url }),
    add: () => mutate({ addUrl: state.url.trim() }),
    remove: (removeKey: string) => mutate({ removeKey }),
    setAutoLink: (autoLink: boolean) => mutate({ autoLink }),
  };
}
