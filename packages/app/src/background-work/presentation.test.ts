import { expect, test } from "vitest";
import { backgroundWorkStatusLead, backgroundWorkText } from "./presentation";

test("shows descriptions and commands once, with useful fallbacks", () => {
  expect(
    backgroundWorkText({ description: "Watch build", command: "tail -f build.log" }, "Monitor"),
  ).toEqual({ title: "Watch build", command: "tail -f build.log" });
  expect(backgroundWorkText({ description: null, command: "sleep 10" }, "Shell")).toEqual({
    title: "sleep 10",
    command: null,
  });
  expect(backgroundWorkText({ description: "sleep 10", command: "sleep 10" }, "Shell")).toEqual({
    title: "sleep 10",
    command: null,
  });
  expect(backgroundWorkText({ description: null }, "Shell")).toEqual({
    title: "Shell",
    command: null,
  });
});

test("leads the status line with model and thinking when the agent has them", () => {
  expect(backgroundWorkStatusLead("GPT-6.1 Terra · Medium", "Shell")).toBe(
    "GPT-6.1 Terra · Medium · ",
  );
  expect(backgroundWorkStatusLead("  ", "Shell")).toBe("Shell · ");
  expect(backgroundWorkStatusLead(null, "Shell")).toBe("Shell · ");
});
