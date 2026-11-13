import { describe, expect, it } from "vitest";
import { createdChangeRequest, parseChangeRequestUrl, standaloneArgv } from "./identity.js";

const remote = "git@git.woa.com:group/repo.git";
const output = JSON.stringify({
  iid: 686,
  web_url: "https://git.woa.com/group/repo/merge_requests/686",
  id: 99123,
});
const detail = {
  type: "shell" as const,
  command: "gw mr create --title 'Add status' --json",
  exitCode: 0,
  output,
};

describe("session change request identities", () => {
  it("deduplicates TGit routes and GitHub casing without flattening namespaces", () => {
    expect(parseChangeRequestUrl("https://git.woa.com/group/repo/-/merge_requests/686")?.key).toBe(
      parseChangeRequestUrl("https://git.woa.com/group/repo/merge_requests/686")?.key,
    );
    expect(parseChangeRequestUrl("https://github.com/Owner/Repo/pull/1")?.key).toBe(
      parseChangeRequestUrl("https://github.com/owner/repo/pull/1")?.key,
    );
    expect(
      parseChangeRequestUrl("https://gitlab.com/Group/sub/repo/-/merge_requests/12")?.projectPath,
    ).toBe("Group/sub/repo");
    expect(
      parseChangeRequestUrl("https://gitlab.com/Group/sub/repo/-/merge_requests/12")?.key,
    ).not.toBe(parseChangeRequestUrl("https://gitlab.com/group/sub/repo/-/merge_requests/12")?.key);
  });
  it.each([
    "http://github.com/a/b/pull/1",
    "https://user:secret@github.com/a/b/pull/1",
    "https://github.com/a/b/../b/pull/1",
    "https://github.com/a%2Fb/c/pull/1",
    "https://github.com/a/b/pull/0",
    "https://github.com/a/b/pull/9007199254740992",
    "https://github.com/a/b/issues/1",
    "https://github.com/a/b/pull/1?x=1",
  ])("rejects unsafe/noncanonical URL %s", (url) => expect(parseChangeRequestUrl(url)).toBeNull());
});

describe("strict create evidence", () => {
  it("recognizes gw's top-level JSON iid/web_url with an exact origin match", () => {
    expect(createdChangeRequest(detail, remote)).toMatchObject({
      forge: "tgit",
      projectPath: "group/repo",
      number: 686,
    });
    expect(
      createdChangeRequest(
        {
          ...detail,
          output: JSON.stringify({
            iid: 686,
            web_url: "https://git.woa.com/group/repo/-/merge_requests/686",
          }),
        },
        remote,
      )?.number,
    ).toBe(686);
  });
  it.each([
    { ...detail, command: "gw mr create --title x" },
    { ...detail, exitCode: 1 },
    { ...detail, exitCode: undefined },
    { ...detail, command: "gw mr view 686 --json" },
    { ...detail, command: "echo ok && gw mr create --json" },
    { ...detail, command: "gw mr create --json; echo done" },
    { ...detail, command: "gw mr create --json | cat" },
    { ...detail, command: 'gw mr create --title "$(echo x)" --json' },
    { ...detail, command: "gw mr create --json\necho ok" },
    {
      ...detail,
      output: "Created MR !686: title\nhttps://git.woa.com/group/repo/merge_requests/686",
    },
    {
      ...detail,
      output: JSON.stringify({
        iid: 12,
        web_url: "https://git.woa.com/group/repo/merge_requests/686",
      }),
    },
    {
      ...detail,
      output: JSON.stringify({
        iid: 686,
        web_url: "https://git.woa.com/other/repo/merge_requests/686",
      }),
    },
    {
      ...detail,
      output: JSON.stringify({
        iid: 686,
        web_url: "https://evil.test/group/repo/merge_requests/686",
      }),
    },
    { ...detail, output: "null" },
    { ...detail, output: JSON.stringify({ iid: 686, target_project_id: 100 }) },
    {
      ...detail,
      output: JSON.stringify({
        iid: "686",
        web_url: "https://git.woa.com/group/repo/merge_requests/686",
      }),
    },
  ])("rejects ambiguous or unsuccessful evidence %#", (input) =>
    expect(createdChangeRequest(input, remote)).toBeNull(),
  );
  it("supports explicit gh/glab repository targets, never a URL in a command argument", () => {
    expect(
      createdChangeRequest(
        {
          type: "shell",
          command: "gh pr create --repo other/project --title 'Fix; docs'",
          output: "https://github.com/other/project/pull/7",
          exitCode: 0,
        },
        "https://github.com/local/repo.git",
      )?.projectPath,
    ).toBe("other/project");
    expect(
      createdChangeRequest(
        {
          type: "shell",
          command: "glab mr create --repo https://gitlab.com/group/sub/repo --title Fix",
          output: "https://gitlab.com/group/sub/repo/-/merge_requests/7",
          exitCode: 0,
        },
        null,
      )?.number,
    ).toBe(7);
    expect(
      createdChangeRequest(
        {
          ...detail,
          command: "gh pr create --body 'https://github.com/other/project/pull/7'",
          output: "https://github.com/other/project/pull/7",
        },
        "https://github.com/local/repo.git",
      ),
    ).toBeNull();
    expect(standaloneArgv("gh pr create --title 'a && b' ")).toEqual([
      "gh",
      "pr",
      "create",
      "--title",
      "a && b",
    ]);
  });
});

it("recognizes gw's final JSON after its automatic push, but never a URL in push logs", () => {
  const pushed =
    "branch 'feature' set up to track 'origin/feature'.\nTo git.woa.com:group/repo.git\n * [new branch] feature -> feature\n";
  expect(createdChangeRequest({ ...detail, output: pushed + output + "\n" }, remote)?.number).toBe(
    686,
  );
  expect(
    createdChangeRequest(
      { ...detail, output: pushed + "https://git.woa.com/group/repo/merge_requests/686" },
      remote,
    ),
  ).toBeNull();
  expect(
    createdChangeRequest({ ...detail, output: pushed + output + "\ntruncated" }, remote),
  ).toBeNull();
  expect(
    createdChangeRequest(
      {
        ...detail,
        output:
          pushed +
          JSON.stringify({ iid: 12, web_url: "https://git.woa.com/group/repo/merge_requests/686" }),
      },
      remote,
    ),
  ).toBeNull();
});
