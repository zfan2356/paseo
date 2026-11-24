import { describe, expect, it } from "vitest";
import { dashboardBounds } from "./dashboard.js";
import { dashboardDocument } from "./dashboard-document.js";

describe("task board", () => {
  it("stays within a small display with a negative origin", () => {
    const area = { x: -800, y: 24, width: 800, height: 480 };
    const bounds = dashboardBounds({ x: -20, y: 0, width: 20, height: 24 }, area);
    expect(bounds).toEqual({ x: -400, y: 32, width: 392, height: 464 });
  });

  it("anchors below a tray icon in the center of a display", () => {
    expect(
      dashboardBounds(
        { x: 600, y: 0, width: 20, height: 24 },
        { x: 0, y: 24, width: 1440, height: 900 },
      ),
    ).toEqual({ x: 414, y: 32, width: 392, height: 600 });
  });

  it("uses a restricted nonce script and no interpolation of task HTML", () => {
    const document = dashboardDocument("test-nonce");
    expect(document).toContain("script-src 'nonce-test-nonce'");
    expect(document).toContain("connect-src 'none'");
    expect(document).not.toContain("innerHTML");
    expect(document).toContain("prefers-reduced-transparency");
    expect(document).toContain('aria-label="任务列表"');
    expect(document).not.toContain("来源与速度");
    expect(document).not.toContain("切换来源 / Ultra fast");
    expect(document).toContain("刷新额度");
    expect(document.indexOf("main.append(quotaSection)")).toBeGreaterThan(
      document.indexOf("main.append(section)"),
    );
    expect(document).toContain(
      "if(report.state==='not-configured'||report.state==='loading')continue",
    );
    expect(document).not.toContain("暂无账号额度，请在主机上启用 Magpie");
  });
});
