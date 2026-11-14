import config from "./playwright.config";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  ...config,
  use: {
    ...config.use,
    video: "off",
    trace: "off",
    launchOptions: {
      executablePath:
        "/data/home/jayjayzhang/.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell",
      args: ["--no-sandbox"],
    },
  },
});
