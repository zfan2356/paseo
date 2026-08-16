import { test, expect, type Page } from "../support/fixtures";
import { TerminalE2EHarness } from "../support/helpers/terminal-dsl";
import { getTerminalBufferText, waitForTerminalContent } from "../support/helpers/terminal-perf";

interface RestoreWriteSpyState {
  armed: boolean;
  oldHits: number;
  resetHits: number;
}

async function installRestoreWriteSpy(page: Page, oldMarker: string): Promise<void> {
  await page.addInitScript((marker) => {
    interface SpyTerm {
      write?: (data: string | Uint8Array, callback?: () => void) => void;
      __paseoRestoreSpyWrapped?: boolean;
    }
    interface RestoreSpyState {
      armed: boolean;
      oldHits: number;
      resetHits: number;
    }

    const win = window as unknown as {
      __paseoTerminal?: SpyTerm;
      __paseoRestoreSpy?: RestoreSpyState;
    };
    const spy: RestoreSpyState = {
      armed: false,
      oldHits: 0,
      resetHits: 0,
    };
    win.__paseoRestoreSpy = spy;

    const wrap = (term: SpyTerm | undefined) => {
      if (!term?.write || term.__paseoRestoreSpyWrapped) {
        return;
      }
      const originalWrite = term.write.bind(term);
      term.write = (data: string | Uint8Array, callback?: () => void) => {
        if (spy.armed) {
          const text = typeof data === "string" ? data : new TextDecoder().decode(data);
          if (text.includes(marker)) {
            spy.oldHits += 1;
          }
          if (text.includes("\u001bc")) {
            spy.resetHits += 1;
          }
        }
        return originalWrite(data, callback);
      };
      term.__paseoRestoreSpyWrapped = true;
    };

    let current = win.__paseoTerminal;
    wrap(current);
    Object.defineProperty(win, "__paseoTerminal", {
      configurable: true,
      get() {
        return current;
      },
      set(next: SpyTerm | undefined) {
        current = next;
        wrap(next);
      },
    });
  }, oldMarker);
}

async function armRestoreWriteSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    const spy = (window as Window & { __paseoRestoreSpy?: RestoreWriteSpyState }).__paseoRestoreSpy;
    if (!spy) {
      throw new Error("restore write spy was not installed");
    }
    spy.armed = true;
    spy.oldHits = 0;
    spy.resetHits = 0;
  });
}

async function readRestoreWriteSpy(page: Page): Promise<{ oldHits: number; resetHits: number }> {
  return page.evaluate(() => {
    const spy = (
      window as Window & {
        __paseoRestoreSpy?: RestoreWriteSpyState;
      }
    ).__paseoRestoreSpy;
    if (!spy) {
      throw new Error("restore write spy was not installed");
    }
    return { oldHits: spy.oldHits, resetHits: spy.resetHits };
  });
}

test.describe("Terminal restore replay", () => {
  test.describe.configure({ timeout: 120_000 });

  let harness: TerminalE2EHarness;

  test.beforeAll(async () => {
    harness = await TerminalE2EHarness.create({ tempPrefix: "terminal-restore-replay-" });
  });

  test.afterAll(async () => {
    await harness?.cleanup();
  });

  test("reopening a long session does not write old scrollback into the emulator", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const stamp = Date.now();
    const oldMarker = `OLD_RESTORE_${stamp}`;
    const newMarker = `NEW_RESTORE_${stamp}`;
    await installRestoreWriteSpy(page, oldMarker);

    const primary = await harness.createTerminal({ name: "restore-primary" });
    const secondary = await harness.createTerminal({ name: "restore-secondary" });

    try {
      await harness.openTerminal(page, { terminalId: primary.id });
      await harness.setupPrompt(page);

      const terminal = harness.terminalSurface(page);
      await terminal.pressSequentially(
        `echo ${oldMarker}; for i in $(seq 1 80); do echo HISTORY_$i; done; echo ${newMarker}\n`,
        { delay: 0 },
      );
      await waitForTerminalContent(
        page,
        (text) => text.includes(oldMarker) && text.includes(newMarker),
        15_000,
      );

      await page.getByTestId(`workspace-tab-terminal_${secondary.id}`).first().click();
      await expect(
        page.getByTestId("terminal-surface").filter({ visible: true }).first(),
      ).toBeVisible();

      await armRestoreWriteSpy(page);
      await page.getByTestId(`workspace-tab-terminal_${primary.id}`).first().click();
      await expect
        .poll(() => getTerminalBufferText(page), { timeout: 15_000 })
        .toContain(newMarker);
      await page
        .locator('[data-testid="terminal-attach-loading"]')
        .waitFor({ state: "hidden", timeout: 10_000 })
        .catch(() => undefined);

      const spy = await readRestoreWriteSpy(page);
      expect(spy.resetHits, "reopen should restore through a snapshot reset write").toBeGreaterThan(
        0,
      );
      expect(spy.oldHits, "visible restore must not replay older scrollback into xterm").toBe(0);

      const restoredText = await getTerminalBufferText(page);
      expect(restoredText).toContain(newMarker);
    } finally {
      await harness.killTerminal(primary.id);
      await harness.killTerminal(secondary.id);
    }
  });
});
