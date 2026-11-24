import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const MATH_RESPONSE = [
  "Inline formula: $E = mc^2$",
  "",
  "$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$",
].join("\n");

test("renders formulas with the surrounding text color in the pure black theme", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme: "pureBlack" }));
  });

  const agent = await seedMockAgentWorkspace({
    repoPrefix: "markdown-math-theme-",
    title: "Markdown math theme",
    featureValues: {
      mockStreamingAssistantResponse: MATH_RESPONSE,
      mockStreamingAssistantIntervalMs: 1,
    },
  });

  try {
    await openAgentRoute(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "Render formulas.");
    await agent.client.waitForFinish(agent.agentId, 30_000);

    const formulas = page.locator("[data-paseo-math]");
    await expect(formulas).toHaveCount(2);

    for (const formula of await formulas.all()) {
      await expect(formula).toHaveCSS("color", "rgb(250, 250, 250)");
      await expect(formula.locator("math")).toHaveCSS("color", "rgb(250, 250, 250)");
    }
  } finally {
    await agent.cleanup();
  }
});
