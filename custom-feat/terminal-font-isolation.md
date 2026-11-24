# Terminal font isolation

- Status: active
- Commits: `51e58257e`
- Ledger entry: "Terminal font isolation"

## Original requirement

Changing the interface font must not misalign terminal columns. Terminal
emulators need their own monospace cell metrics, including when WebGL falls
back to the DOM renderer.

## Design

The terminal runtime marks its host with `data-pmono`, the
existing interface-font exclusion boundary. Xterm remains responsible for
its font and cell measurements; interface styles do not reach terminal rows.

The browser regression mounts a real emulator under both `root` and
`overlay-root`, switches the interface font, forces DOM rendering by losing
the WebGL context, and verifies that column endpoints remain aligned.

Owning files:

- `packages/app/src/terminal/runtime/terminal-emulator-runtime.ts`
- `packages/app/src/terminal/runtime/terminal-font-isolation.browser.test.ts`
