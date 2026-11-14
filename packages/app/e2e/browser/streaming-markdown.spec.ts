import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { holdAssistantStream } from "../support/helpers/agent-timeline-gate";
import {
  withAcpStreamingMarkdown,
  requestAcpMarkdown,
  expectAcpMarkdown,
  reloadAcpMarkdown,
} from "../support/helpers/acp-streaming-markdown";
import {
  expectFinishedMarkdown,
  expectReloadedMarkdown,
  expectUnfinishedBold,
  expectUnfinishedLink,
  requestStreamingMarkdown,
  withStreamingMarkdown,
} from "../support/helpers/streaming-markdown";

test("formats unfinished Markdown while streaming and preserves the completed rendering", async ({
  page,
}, testInfo) => {
  await withStreamingMarkdown(page, testInfo, async (agent) => {
    await requestStreamingMarkdown(agent);
    await expectUnfinishedBold(page);
    await expectUnfinishedLink(page, agent, testInfo);
    await expectFinishedMarkdown(page, agent, testInfo);
    await expectReloadedMarkdown(page);
  });
});

for (const width of [1100, 390]) {
  test(`web citation controls stay hidden during streaming and reload at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const prefix = "因此有两个层次：\n\n- **验证可行性**：以 `--no-deps` 安装。 ";
    const response =
      prefix +
      "\uE200cite\uE202turn947199search0\uE201\n" +
      "- **正式长期方案**：整理 MMQ 的依赖声明。 \uE200cite\uE202turn947199search1\uE201\n\n" +
      "[安装说明](https://example.com/install)";
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "markdown-citations-",
      title: "Citation rendering",
      featureValues: {
        mockStreamingAssistantResponse: response,
        mockStreamingAssistantIntervalMs: 400,
      },
    });
    const stream = await holdAssistantStream(page, agent.agentId);
    try {
      await openAgentRoute(page, agent);
      await stream.waitForInitialTimeline();
      await agent.client.sendAgentMessage(agent.agentId, "Show the installation guidance.");
      await agent.client.waitForFinish(agent.agentId, 30_000);
      // Stop on a four-character mock chunk before the citation is complete.
      await stream.showThrough(prefix + "\uE200cite\uE202turn947199sear");
      const message = page.getByTestId("assistant-message").last();
      await expect(message).toContainText("验证可行性");
      await expect(message).not.toContainText(/\uE200|turn947199/);
      stream.release();
      await expect(message).toContainText("正式长期方案");
      await expect(message.getByRole("link", { name: "安装说明" })).toHaveAttribute(
        "href",
        "https://example.com/install",
      );
      await expect(message).not.toContainText(/\uE200|turn947199/);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(message).toContainText("正式长期方案");
      await expect(message).not.toContainText(/\uE200|turn947199/);
      const screenshot = testInfo.outputPath("citations-rendered.png");
      await page.screenshot({ path: screenshot });
      await testInfo.attach("Citation rendering after reload", {
        path: screenshot,
        contentType: "image/png",
      });
    } finally {
      stream.release();
      await agent.cleanup();
    }
  });

  test(`ACP plugin chunks preserve Markdown and separate turns at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await withAcpStreamingMarkdown(page, async (agent) => {
      await requestAcpMarkdown(agent);
      await expectAcpMarkdown(page, 1);
      await requestAcpMarkdown(agent);
      await expectAcpMarkdown(page, 2);
      await reloadAcpMarkdown(page, testInfo);
    });
  });
}
