import { expect, it } from "vitest";
import { openDirectoryForm } from "./directory-form";
it("retries binding the existing created worktree after a link failure", async () => {
  const created: string[] = [];
  const links: string[] = [];
  let reject = true;
  let succeeded = false;
  const form = openDirectoryForm({
    create: async (name) => {
      created.push(name);
      return "/wt";
    },
    link: async (path) => {
      links.push(path);
      if (reject) throw new Error("Host disconnected");
    },
    success: () => {
      succeeded = true;
    },
  });
  form.setInput("test");
  await form.submit();
  expect(form.getState()).toMatchObject({
    status: "error",
    error: "Host disconnected",
    createdPath: "/wt",
  });
  reject = false;
  await form.submit();
  expect(created).toEqual(["test"]);
  expect(links).toEqual(["/wt", "/wt"]);
  expect(succeeded).toBe(true);
});
it("keeps invalid directory input and visible error for a retry", async () => {
  const form = openDirectoryForm({
    link: async () => {
      throw new Error("Directory does not exist");
    },
    success: () => {},
  });
  form.setInput("/missing");
  await form.submit();
  expect(form.getState()).toEqual({
    input: "/missing",
    inputRevision: 0,
    createdPath: null,
    status: "error",
    error: "Directory does not exist",
  });
  form.choosePath("/valid");
  expect(form.getState().inputRevision).toBe(1);
  form.setInput("/valid/subdir");
  expect(form.getState().inputRevision).toBe(1);
});
