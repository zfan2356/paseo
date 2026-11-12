import { describe, expect, it } from "vitest";
import fixture from "./fixtures/tgit/v3.json";
import { createTgitService, TgitApiError, TgitUnsupportedOperationError } from "./tgit-service.js";
import { ForgeAuthenticationError } from "./forge-cli-command.js";
import { createForgeResolver } from "./forge-resolver.js";

const cwd = "/repo";
const mrOptions = { cwd, number: 686 };
const statusOptions = { cwd, headRef: "feature/worker", headSha: "abc123" };
const timelineOptions = { cwd, prNumber: 686, repoOwner: "example", repoName: "repo" };
const checkOptions = { cwd, changeRequestNumber: 686, checkRunId: 77 };
const projectPath = "/api/v3/projects/example%2Frepo";

interface FakeResponse {
  status: number;
  body: unknown;
}
interface FakeRequest {
  url: URL;
  init: RequestInit | undefined;
}

function setup() {
  let token: string | undefined = "test-only-token";
  let remote = "git@git.woa.com:example/repo.git";
  const requests: FakeRequest[] = [];
  const routes = new Map<string, FakeResponse>([
    ["/api/v3/user", { status: 200, body: { id: 1 } }],
    [projectPath, { status: 200, body: fixture.project }],
    ["/api/v3/projects/100", { status: 200, body: fixture.project }],
    [`${projectPath}/merge_requests`, { status: 200, body: [fixture.mr] }],
    [`${projectPath}/merge_request/iid/686`, { status: 200, body: fixture.mr }],
    [`${projectPath}/commits/abc123/status`, { status: 200, body: fixture.checks }],
    [`${projectPath}/merge_request/99123/review`, { status: 200, body: fixture.review }],
    [`${projectPath}/repository/branches/main`, { status: 200, body: fixture.branch }],
    [
      `${projectPath}/merge_request/99123/merge_conflict_check`,
      { status: 200, body: fixture.conflict },
    ],
    [`${projectPath}/merge_request/99123/comments`, { status: 200, body: fixture.comments }],
    [`${projectPath}/issues`, { status: 200, body: fixture.issues }],
  ]);
  let respond = (url: URL): FakeResponse => {
    if (url.searchParams.get("state") === "all") return { status: 200, body: [] };
    const response = routes.get(url.pathname);
    if (!response) throw new Error(`Unexpected fixture request ${url.pathname}`);
    return response;
  };
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    const response = respond(url);
    return new Response(JSON.stringify(response.body), { status: response.status });
  };
  const service = createTgitService({
    fetch: transport,
    readToken: () => token,
    resolveRemoteUrl: async () => remote,
  });
  return {
    service,
    requests,
    routes,
    setToken(value: string | undefined) {
      token = value;
    },
    setRemote(value: string) {
      remote = value;
    },
    setRespond(value: typeof respond) {
      respond = value;
    },
  };
}

describe("TGit v3 adapter", () => {
  it("resolves cloud SSH/HTTPS remotes without probing", () => {
    const resolver = createForgeResolver();
    for (const remote of [
      "git@git.woa.com:example/repo.git",
      "https://git.woa.com/example/repo.git",
    ]) {
      expect(resolver.resolveFromRemoteUrl(remote)?.forge).toBe("tgit");
    }
    expect(
      resolver.resolveFromRemoteUrl("https://git.woa.com.evil.test/example/repo.git"),
    ).toBeNull();
  });

  it("authenticates using GET /user and only sends credentials to the fixed origin", async () => {
    const fake = setup();
    expect(await fake.service.isAuthenticated({ cwd })).toBe(true);
    expect(fake.requests[0].url.origin).toBe("https://git.woa.com");
    expect(fake.requests[0].init).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { "PRIVATE-TOKEN": "test-only-token" },
    });
    fake.setRemote("https://evil.test/example/repo");
    await expect(fake.service.listPullRequests({ cwd })).rejects.toThrow("git.woa.com remote");
    expect(fake.requests).toHaveLength(1);
  });

  it("reports missing/expired credentials as unauthenticated without returning secrets", async () => {
    const fake = setup();
    fake.setToken(undefined);
    expect(await fake.service.isAuthenticated({ cwd })).toBe(false);
    await expect(fake.service.getCurrentPullRequestStatus(statusOptions)).rejects.toBeInstanceOf(
      ForgeAuthenticationError,
    );
    expect(await fake.service.searchIssuesAndPrs({ cwd, query: "worker" })).toMatchObject({
      authState: "unauthenticated",
      featuresEnabled: false,
    });
    expect(fake.requests).toHaveLength(0);
    fake.setToken("test-only-token");
    fake.routes.set("/api/v3/user", { status: 401, body: { message: "test-only-token" } });
    expect(await fake.service.isAuthenticated({ cwd })).toBe(false);
    fake.routes.set(`${projectPath}/merge_requests`, { status: 403, body: {} });
    expect(
      await fake.service.searchIssuesAndPrs({ cwd, query: "x", kinds: ["change_request"] }),
    ).toMatchObject({ authState: "unauthenticated" });
  });

  it("sanitizes response/schema/network errors", async () => {
    const fake = setup();
    fake.routes.set(`${projectPath}/merge_request/iid/686`, {
      status: 500,
      body: { message: "test-only-token" },
    });
    await expect(fake.service.getPullRequest(mrOptions)).rejects.toThrow("HTTP 500");
    fake.routes.set(`${projectPath}/merge_request/iid/686`, {
      status: 200,
      body: { secret: "test-only-token" },
    });
    await expect(fake.service.getPullRequest(mrOptions)).rejects.toThrow("invalid response");
    fake.setRespond(() => {
      throw new Error("test-only-token");
    });
    await expect(fake.service.getPullRequest(mrOptions)).rejects.toThrow("could not be reached");
  });

  it("lists/reads MRs with IID URLs, searches numbers including terminal MRs, and lists issues", async () => {
    const { service, requests } = setup();
    expect(await service.listPullRequests({ cwd, query: "worker", limit: 2 })).toMatchObject([
      {
        number: 686,
        state: "open",
        url: "https://git.woa.com/example/repo/-/merge_requests/686",
        baseRefName: "main",
      },
    ]);
    expect(requests[0].url.searchParams.get("search")).toBe("worker");
    expect(await service.getPullRequest(mrOptions)).toMatchObject({
      number: 686,
      headRefName: "feature/worker",
    });
    expect(
      await service.searchIssuesAndPrs({ cwd, query: "!686", kinds: ["change_request"] }),
    ).toMatchObject({
      authState: "authenticated",
      items: [{ kind: "change_request", forge: "tgit", number: 686 }],
    });
    expect(await service.listIssues({ cwd })).toMatchObject([{ number: 12 }]);
    expect(await service.searchIssuesAndPrs({ cwd, query: "#12", kinds: ["issue"] })).toMatchObject(
      { items: [{ kind: "issue", number: 12 }] },
    );
  });

  it("provides fork checkout URLs and disambiguated local branch names", async () => {
    const fake = setup();
    fake.routes.set(`${projectPath}/merge_request/iid/686`, {
      status: 200,
      body: { ...fixture.mr, source_project_id: 200 },
    });
    fake.routes.set("/api/v3/projects/200", {
      status: 200,
      body: { id: 200, path_with_namespace: "contributor/repo" },
    });
    expect(await fake.service.getPullRequestHeadRef(mrOptions)).toBe("feature/worker");
    const target = await fake.service.getPullRequestCheckoutTarget(mrOptions);
    expect(target).toMatchObject({
      isCrossRepository: true,
      headOwnerLogin: "contributor",
      headRepositorySshUrl: "git@git.woa.com:contributor/repo.git",
      checkoutRefs: [
        {
          remoteName: "git@git.woa.com:contributor/repo.git",
          remoteRef: "refs/heads/feature/worker",
        },
      ],
    });
    expect(
      fake.service.buildPrLocalBranchName?.({
        headRef: target.headRefName,
        checkoutTarget: target,
      }),
    ).toBe("contributor/feature/worker");
    fake.setRemote("https://git.woa.com/example/repo.git");
    expect((await fake.service.getPullRequestCheckoutTarget(mrOptions)).checkoutRefs).toEqual([
      {
        remoteName: "https://git.woa.com/contributor/repo.git",
        remoteRef: "refs/heads/feature/worker",
      },
    ]);
  });

  it("maps current MR checks, CI gates, review and independently computed conflicts", async () => {
    const fake = setup();
    expect(await fake.service.getCurrentPullRequestStatus(statusOptions)).toMatchObject({
      number: 686,
      state: "open",
      checksStatus: "success",
      mergeable: "MERGEABLE",
      reviewDecision: "approved",
      forgeSpecific: { forge: "tgit", readOnly: true },
    });
    fake.routes.set(`${projectPath}/merge_request/iid/686`, {
      status: 200,
      body: { ...fixture.mr, commit_check_block: true },
    });
    expect(await fake.service.getCurrentPullRequestStatus(statusOptions)).toMatchObject({
      checksStatus: "pending",
      mergeable: "MERGEABLE",
    });
    fake.routes.set(`${projectPath}/merge_request/99123/merge_conflict_check`, {
      status: 200,
      body: { ...fixture.conflict, has_conflicts: true },
    });
    expect(await fake.service.getCurrentPullRequestStatus(statusOptions)).toMatchObject({
      mergeable: "CONFLICTING",
    });
    fake.routes.set(`${projectPath}/merge_request/99123/merge_conflict_check`, {
      status: 200,
      body: { ...fixture.conflict, base_commit: "old" },
    });
    expect(await fake.service.getCurrentPullRequestStatus(statusOptions)).toMatchObject({
      mergeable: "UNKNOWN",
    });
  });

  it("does not count mirrored CI gates as additional concrete checks", async () => {
    const fake = setup();
    expect((await fake.service.getCurrentPullRequestStatus(statusOptions))?.checks).toHaveLength(1);
    fake.routes.set(`${projectPath}/commits/abc123/status`, {
      status: 200,
      body: {
        ...fixture.checks,
        state: "failure",
        block: true,
        statuses: [{ ...fixture.checks.statuses[0], state: "failure" }],
      },
    });
    const status = await fake.service.getCurrentPullRequestStatus(statusOptions);
    expect(status?.checksStatus).toBe("failure");
    expect(status?.checks).toHaveLength(1);
  });

  it("does not associate reused branches, forks, or stale terminal requests", async () => {
    const fake = setup();
    fake.routes.set(`${projectPath}/merge_requests`, {
      status: 200,
      body: [{ ...fixture.mr, state: "merged" }],
    });
    expect(
      await fake.service.getCurrentPullRequestStatus({ ...statusOptions, headSha: "new" }),
    ).toBeNull();
    expect(
      await fake.service.getCurrentPullRequestStatus({ ...statusOptions, headSha: undefined }),
    ).toBeNull();
    fake.routes.set(`${projectPath}/merge_requests`, {
      status: 200,
      body: [{ ...fixture.mr, source_project_id: 200 }],
    });
    expect(await fake.service.getCurrentPullRequestStatus(statusOptions)).toBeNull();
  });

  it("finds terminal MRs only for the same SHA and omits TGit's unsupported state=all", async () => {
    const fake = setup();
    const closed = { ...fixture.mr, state: "closed" };
    fake.routes.set(`${projectPath}/merge_requests`, { status: 200, body: [closed] });
    fake.routes.set(`${projectPath}/merge_request/iid/686`, { status: 200, body: closed });
    expect(await fake.service.getCurrentPullRequestStatus(statusOptions)).toMatchObject({
      state: "closed",
      headSha: "abc123",
      mergeable: "UNKNOWN",
    });
    const lookup = fake.requests.find((request) =>
      request.url.pathname.endsWith("/merge_requests"),
    );
    expect(lookup?.url.searchParams.has("state")).toBe(false);
  });

  it("rejects checks for the wrong SHA and incomplete pagination", async () => {
    const fake = setup();
    fake.routes.set(`${projectPath}/commits/abc123/status`, {
      status: 200,
      body: { ...fixture.checks, sha: "old" },
    });
    await expect(fake.service.getCurrentPullRequestStatus(statusOptions)).rejects.toThrow(
      "changed during refresh",
    );
    fake.routes.set(`${projectPath}/commits/abc123/status`, {
      status: 200,
      body: { ...fixture.checks, total_count: 2, statuses: [] },
    });
    await expect(fake.service.getCheckDetails(checkOptions)).rejects.toThrow(
      "pagination was incomplete",
    );
  });

  it("reads all status pages, filters target branches and keeps check details on the MR head", async () => {
    const fake = setup();
    fake.setRespond((url) => {
      if (url.pathname.endsWith("/status")) {
        const id = url.searchParams.get("page") === "1" ? 76 : 77;
        const check = {
          ...fixture.checks.statuses[0],
          id,
          target_branches: id === 76 ? ["release"] : ["main"],
        };
        return { status: 200, body: { ...fixture.checks, total_count: 2, statuses: [check] } };
      }
      const response = fake.routes.get(url.pathname);
      if (!response) throw new Error("unexpected route");
      return response;
    });
    expect(await fake.service.getCheckDetails(checkOptions)).toMatchObject({
      checkRunId: 77,
      name: "unit",
      output: { summary: "Tests passed", text: "### Test report\n\nAll checks passed." },
    });
    await expect(
      fake.service.getCheckDetails({ ...checkOptions, checkRunId: 76 }),
    ).rejects.toBeInstanceOf(TgitApiError);
  });

  it("sorts timeline comments and keeps unsafe check links out of the UI", async () => {
    const fake = setup();
    expect(await fake.service.getPullRequestTimeline(timelineOptions)).toMatchObject({
      items: [
        { id: "tgit-comment-1", body: "Please review" },
        { id: "tgit-comment-2", body: "Looks good" },
        { id: "tgit-comment-3", body: "Reply in thread", threadId: "tgit-thread-1" },
      ],
      truncated: false,
    });
    fake.routes.set(`${projectPath}/commits/abc123/status`, {
      status: 200,
      body: {
        ...fixture.checks,
        statuses: [{ ...fixture.checks.statuses[0], target_url: "javascript:alert(1)" }],
      },
    });
    expect(await fake.service.getCheckDetails(checkOptions)).toMatchObject({
      url: null,
      detailsUrl: null,
    });
  });

  it("refuses every write method without invoking HTTP", async () => {
    const fake = setup();
    await expect(
      fake.service.createPullRequest({ cwd, title: "x", head: "x", base: "main" }),
    ).rejects.toBeInstanceOf(TgitUnsupportedOperationError);
    await expect(
      fake.service.mergePullRequest({ cwd, prNumber: 686, mergeMethod: "merge" }),
    ).rejects.toBeInstanceOf(TgitUnsupportedOperationError);
    await expect(
      fake.service.enablePullRequestAutoMerge({ cwd, prNumber: 686, mergeMethod: "merge" }),
    ).rejects.toBeInstanceOf(TgitUnsupportedOperationError);
    await expect(
      fake.service.disablePullRequestAutoMerge({ cwd, prNumber: 686 }),
    ).rejects.toBeInstanceOf(TgitUnsupportedOperationError);
    expect(fake.requests).toHaveLength(0);
  });
});
