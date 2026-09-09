import { page } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import "@xterm/xterm/css/xterm.css";
import { applyRootUiFont } from "@/appearance/apply-root-font.web";
import { encodeTerminalOutput, TerminalEmulatorRuntime } from "./terminal-emulator-runtime";

const runtime = new TerminalEmulatorRuntime();
let root: HTMLDivElement | null = null;

afterEach(() => {
  runtime.unmount();
  root?.remove();
  root = null;
  document.getElementById("paseo-ui-font")?.remove();
  document.documentElement.style.removeProperty("--paseo-ui-font");
});

async function useDomRenderer(host: HTMLElement): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  for (const canvas of host.querySelectorAll<HTMLCanvasElement>(".xterm-screen > canvas")) {
    const context = canvas.getContext("webgl2");
    if (!context) {
      continue;
    }
    const extension = context.getExtension("WEBGL_lose_context");
    if (!extension) {
      throw new Error("The terminal WebGL renderer does not support context loss");
    }
    extension.loseContext();
  }
  await expect.poll(() => host.querySelector(".xterm-rows"), { timeout: 5_000 }).not.toBeNull();
}

function rowEnd(host: HTMLElement, row: number): HTMLElement {
  const element = host.querySelector<HTMLElement>(
    `.xterm-rows > div:nth-child(${row}) > span.xterm-fg-1`,
  );
  if (!element) {
    throw new Error(`Terminal row ${row} has not rendered`);
  }
  return element;
}

describe("terminal font isolation", () => {
  it.each(["root", "overlay-root"])(
    "keeps terminal columns aligned inside #%s when the UI font changes",
    async (rootId) => {
      await page.viewport(900, 600);
      root = document.createElement("div");
      root.id = rootId;
      root.style.width = "720px";
      root.style.height = "360px";
      document.body.appendChild(root);

      const label = document.createElement("span");
      label.textContent = "Interface label";
      root.appendChild(label);
      const host = document.createElement("div");
      host.style.width = "720px";
      host.style.height = "320px";
      root.appendChild(host);
      applyRootUiFont("sans-serif");
      runtime.mount({
        root,
        host,
        initialSnapshot: null,
        scrollback: 100,
        fontFamily: "monospace",
        theme: { background: "#222222", foreground: "#dddddd" },
      });
      await useDomRenderer(host);
      runtime.write({
        data: encodeTerminalOutput("|iiiiiiii\x1b[31m|\x1b[0m\r\n|WWWWWWWW\x1b[31m|\x1b[0m"),
      });
      await expect.poll(() => host.textContent).toContain("WWWWWWWW");

      const narrowRowEnd = rowEnd(host, 1);
      const wideRowEnd = rowEnd(host, 2);
      expect(narrowRowEnd.textContent).toBe("|");
      expect(wideRowEnd.textContent).toBe("|");
      expect(getComputedStyle(label).fontFamily).toBe("sans-serif");
      expect(getComputedStyle(narrowRowEnd).fontFamily).toBe("monospace");
      expect(narrowRowEnd.getBoundingClientRect().left).toBeCloseTo(
        wideRowEnd.getBoundingClientRect().left,
        1,
      );

      applyRootUiFont("serif");
      expect(getComputedStyle(label).fontFamily).toBe("serif");
      expect(getComputedStyle(narrowRowEnd).fontFamily).toBe("monospace");
      expect(narrowRowEnd.getBoundingClientRect().left).toBeCloseTo(
        wideRowEnd.getBoundingClientRect().left,
        1,
      );
    },
    10_000,
  );
});
