import { describe, expect, it } from "vitest";
import type { Query } from "@anthropic-ai/claude-agent-sdk";

import { askClaudeSideQuestion } from "./query.js";

function queryWithSideQuestion(impl: ((question: string) => Promise<unknown>) | undefined): Query {
  return { askSideQuestion: impl } as unknown as Query;
}

describe("askClaudeSideQuestion", () => {
  it("forwards the question and normalizes the answer", async () => {
    const asked: string[] = [];
    const query = queryWithSideQuestion(async (question) => {
      asked.push(question);
      return { response: "The build failed because of a missing import.", synthetic: false };
    });
    await expect(askClaudeSideQuestion(query, "Why did the build fail?")).resolves.toEqual({
      response: "The build failed because of a missing import.",
      synthetic: false,
    });
    expect(asked).toEqual(["Why did the build fail?"]);
  });

  it("marks synthetic fallback answers", async () => {
    const query = queryWithSideQuestion(async () => ({ response: "Fallback", synthetic: true }));
    await expect(askClaudeSideQuestion(query, "q")).resolves.toEqual({
      response: "Fallback",
      synthetic: true,
    });
  });

  it("returns null when the CLI produced no response", async () => {
    const query = queryWithSideQuestion(async () => null);
    await expect(askClaudeSideQuestion(query, "q")).resolves.toBeNull();
  });

  it("rejects when the installed CLI does not expose side questions", async () => {
    const query = queryWithSideQuestion(undefined);
    await expect(askClaudeSideQuestion(query, "q")).rejects.toThrow(
      /does not support side questions/,
    );
  });
});
