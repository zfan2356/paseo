interface DirectoryFormPorts {
  create?(name: string): Promise<string>;
  link(path: string): Promise<void>;
  success(): void;
}
interface DirectoryFormState {
  input: string;
  inputRevision: number;
  createdPath: string | null;
  status: "editing" | "pending" | "error";
  error: string | null;
}
export function openDirectoryForm(ports: DirectoryFormPorts) {
  let state: DirectoryFormState = {
    input: "",
    inputRevision: 0,
    createdPath: null,
    status: "editing",
    error: null,
  };
  let closed = false;
  const listeners = new Set<() => void>();
  function publish(update: Partial<DirectoryFormState>) {
    if (closed) return;
    state = { ...state, ...update };
    for (const listener of listeners) listener();
  }
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: () => {
      closed = true;
      listeners.clear();
    },
    setInput: (input: string) => publish({ input }),
    choosePath: (input: string) => publish({ input, inputRevision: state.inputRevision + 1 }),
    submit: async () => {
      if (closed || state.status === "pending" || !state.input.trim()) return;
      publish({ status: "pending", error: null });
      try {
        let path = state.createdPath ?? state.input.trim();
        if (ports.create && !state.createdPath) {
          path = await ports.create(state.input.trim());
          publish({ createdPath: path });
        }
        await ports.link(path);
        if (!closed) ports.success();
      } catch (error) {
        publish({ status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}
