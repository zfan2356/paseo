import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Fork material layer: GPU-composited Chromium for backdrop-filter evidence and an
// out-of-tree snapshot directory for before/after comparisons. See docs/fork/SYNC.md.
const snapshotDir = process.env.MATERIALS_SNAPSHOT_DIR;

export default defineConfig({
  ...base,
  ...(snapshotDir ? { snapshotPathTemplate: `${snapshotDir}/{arg}{ext}` } : {}),
  use: {
    ...base.use,
    launchOptions: {
      ...(process.env.E2E_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.E2E_CHROMIUM_EXECUTABLE_PATH }
        : {}),
      // Headless Linux otherwise accepts backdrop-filter without compositing the blur.
      ...(process.env.E2E_GPU_COMPOSITING === "1"
        ? {
            args: [
              "--enable-gpu",
              "--use-gl=angle",
              "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader",
            ],
          }
        : {}),
    },
    ...(process.env.E2E_PERFORMANCE === "1" ? { trace: "off", video: "off" } : {}),
  },
});
