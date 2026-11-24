import { contextBridge, ipcRenderer } from "electron";
import type { DashboardSnapshot } from "./dashboard.js";

contextBridge.exposeInMainWorld("paseoBoard", {
  subscribe: (listener: (snapshot: DashboardSnapshot | null) => void) => {
    ipcRenderer.on("paseo:board:snapshot", (_event, snapshot: DashboardSnapshot | null) => {
      listener(snapshot);
    });
    void ipcRenderer.invoke("paseo:board:action", { kind: "ready" });
  },
  act: (action: unknown) => ipcRenderer.invoke("paseo:board:action", action),
});
