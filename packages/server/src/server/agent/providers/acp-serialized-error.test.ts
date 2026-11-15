import { describe, expect, test } from "vitest";

import {
  classifyACPSerializedErrorText,
  parseACPSerializedTurnError,
} from "./acp-serialized-error.js";

// Cursor CLI reports a failed turn by appending this exact line to the assistant
// message and still answering session/prompt with end_turn. Paseo used to render
// it as the answer, so a retry looked like the provider had succeeded.
describe("parseACPSerializedTurnError", () => {
  test("recognizes the retriable error Cursor emits for a cut provider stream", () => {
    expect(
      parseACPSerializedTurnError("Error: RetriableError: [resource_exhausted] Error"),
    ).toEqual({
      kind: "RetriableError",
      code: "resource_exhausted",
      message: "Error",
      retriable: true,
    });
  });

  test("treats a non-retriable kind as a failure without retrying it", () => {
    expect(
      parseACPSerializedTurnError("Error: NonRetriableError: We're having trouble connecting"),
    ).toEqual({
      kind: "NonRetriableError",
      code: undefined,
      message: "We're having trouble connecting",
      retriable: false,
    });
  });

  test("accepts surrounding whitespace from a streamed chunk boundary", () => {
    expect(parseACPSerializedTurnError("\n\nError: ActionRequiredError: Model Blocked").kind).toBe(
      "ActionRequiredError",
    );
  });

  test("keeps prose that mentions an error out of the failure path", () => {
    for (const prose of [
      "The run failed with Error: RetriableError: [resource_exhausted] Error and then continued.",
      "Error: RetriableError: [resource_exhausted] Error\n\nEverything after this is prose.",
      "Error handling is the subject of this review.",
      "I saw an Error: RetriableError once.",
      "",
    ]) {
      expect(parseACPSerializedTurnError(prose)).toBeNull();
    }
  });

  test("rejects a long message and an unknown kind", () => {
    expect(parseACPSerializedTurnError(`Error: RetriableError: ${"x".repeat(400)}`)).toBeNull();
    expect(parseACPSerializedTurnError("Error: SomeOtherError: boom")).toBeNull();
  });
});

describe("classifyACPSerializedErrorText", () => {
  test("settles ordinary prose immediately instead of buffering it", () => {
    expect(classifyACPSerializedErrorText("Here is the review you asked for.")).toBe("settled");
    expect(classifyACPSerializedErrorText("# Title\n\nBody")).toBe("settled");
  });

  test("holds an opening that a later chunk could complete into an error", () => {
    for (const opening of ["E", "Error", "Error:", "Error: Retr"]) {
      expect(classifyACPSerializedErrorText(opening)).toBe("possible");
    }
  });

  test("treats a complete line with no trailing message as an error", () => {
    expect(classifyACPSerializedErrorText("Error: RetriableError:")).toBe("error");
  });

  test("has nothing to hold for an empty chunk", () => {
    expect(classifyACPSerializedErrorText("")).toBe("settled");
  });

  test("settles once the text has diverged from the error grammar", () => {
    expect(classifyACPSerializedErrorText("Error: it failed")).toBe("settled");
    expect(classifyACPSerializedErrorText("Errors are common here")).toBe("settled");
  });

  test("reports the finished line as an error", () => {
    expect(
      classifyACPSerializedErrorText("Error: RetriableError: [resource_exhausted] Error"),
    ).toBe("error");
  });
});
