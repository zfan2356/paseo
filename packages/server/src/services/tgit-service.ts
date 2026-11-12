import { z } from "zod";
import { parseGitRemoteLocation } from "@getpaseo/protocol/git-remote";
import { buildForkLocalBranchName } from "../utils/change-request-checkout.js";
import { defaultResolveRemoteUrl, ForgeAuthenticationError } from "./forge-cli-command.js";
import {
  compareTimelineItems,
  computeChecksStatus,
  createUnavailableSearchResult,
  normalizeForgeSearchKinds,
  parseOptionalTime,
  type CheckDetails,
  type CurrentPullRequestStatus,
  type ForgeService,
  type IssueSummary,
  type PullRequestCheck,
  type PullRequestCheckStatus,
  type PullRequestCheckoutTarget,
  type PullRequestSummary,
  type PullRequestTimeline,
  type PullRequestTimelineItem,
  type SearchResult,
} from "./forge-service.js";

const API = "https://git.woa.com/api/v3";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const idSchema = z.number().int().positive();
const textSchema = z
  .string()
  .nullish()
  .transform((value) => value ?? "");
const mrSchema = z.object({
  id: idSchema,
  iid: idSchema,
  title: z.string(),
  description: textSchema,
  state: z.string(),
  source_branch: z.string(),
  target_branch: z.string(),
  source_project_id: idSchema,
  target_project_id: idSchema,
  source_commit: textSchema,
  updated_at: textSchema,
  labels: z.array(z.string()).default([]),
  work_in_progress: z.boolean().default(false),
  commit_check_state: textSchema,
  commit_check_block: z.boolean().nullable().optional(),
});
const issueSchema = z.object({
  iid: idSchema,
  title: z.string(),
  description: textSchema,
  state: z.string(),
  labels: z.array(z.string()).default([]),
  updated_at: textSchema,
});
const projectSchema = z.object({ id: idSchema, path_with_namespace: z.string().min(3) });
const checkSchema = z.object({
  id: idSchema,
  context: z.string(),
  state: z.string(),
  target_url: textSchema,
  description: textSchema,
  detail: textSchema,
  target_branches: z.array(z.string()).default([]),
});
const checksSchema = z.object({
  sha: z.string(),
  state: textSchema,
  block: z.boolean().nullable().optional(),
  total_count: z.number().int().nonnegative(),
  statuses: z.array(checkSchema),
});
const reviewSchema = z.object({ state: z.string() });
const conflictSchema = z.object({
  has_conflicts: z.boolean().nullable().optional(),
  base_commit: textSchema,
  target_commit: textSchema,
});
const branchSchema = z.object({ commit: z.object({ id: z.string().min(1) }) });
const commentSchema = z.object({
  id: idSchema,
  body: z.string(),
  parent_id: idSchema.nullish(),
  created_at: textSchema,
  author: z.object({ username: z.string(), avatar_url: textSchema }),
  get comments() {
    return z.array(commentSchema).default([]);
  },
});
type TgitMr = z.infer<typeof mrSchema>;
type TgitCheck = z.infer<typeof checkSchema>;

export class TgitApiError extends Error {
  constructor(
    readonly status: number,
    message = `TGit API request failed (HTTP ${status})`,
  ) {
    super(message);
    this.name = "TgitApiError";
  }
}

export class TgitUnsupportedOperationError extends Error {
  constructor() {
    super(
      "TGit write operations are not supported in Paseo. Open the merge request on 工蜂 (TGit).",
    );
    this.name = "TgitUnsupportedOperationError";
  }
}

export interface CreateTgitServiceOptions {
  fetch?: typeof fetch;
  readToken?: () => string | undefined;
  resolveRemoteUrl?: (cwd: string) => Promise<string | null>;
}

function authenticationError(): ForgeAuthenticationError {
  return new ForgeAuthenticationError(
    "Set TGIT_TOKEN in the daemon environment to connect to 工蜂 (TGit).",
    { stderr: "" },
  );
}

function checkStatus(state: string): PullRequestCheckStatus {
  switch (state) {
    case "success":
      return "success";
    case "failure":
    case "failed":
    case "error":
      return "failure";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

function safeWebUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const webProtocol = url.protocol === "https:" || url.protocol === "http:";
    if (!webProtocol || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isOpen(mr: TgitMr): boolean {
  return mr.state === "opened" || mr.state === "reopened";
}

function mrUrl(project: string, number: number): string {
  return `https://git.woa.com/${project}/-/merge_requests/${number}`;
}

function summary(mr: TgitMr, project: string): PullRequestSummary {
  return {
    number: mr.iid,
    title: mr.title,
    url: mrUrl(project, mr.iid),
    state: mr.state,
    body: mr.description || null,
    projectPath: project,
    baseRefName: mr.target_branch,
    headRefName: mr.source_branch,
    labels: mr.labels,
    updatedAt: mr.updated_at,
  };
}

function boundedLimit(limit = 20): number {
  return Math.max(1, Math.min(limit, PAGE_SIZE * MAX_PAGES));
}

export function createTgitService(options: CreateTgitServiceOptions = {}): ForgeService {
  const request = options.fetch ?? fetch;
  const readToken = options.readToken ?? (() => process.env.TGIT_TOKEN);
  const resolveRemoteUrl = options.resolveRemoteUrl ?? defaultResolveRemoteUrl;

  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const token = readToken();
    if (!token) throw authenticationError();
    let response: Response;
    try {
      response = await request(`${API}${path}`, {
        method: "GET",
        headers: { "PRIVATE-TOKEN": token, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Fetch errors may include request headers in their cause. Keep credentials
      // and upstream response bodies out of daemon logs and RPC errors.
      throw new TgitApiError(0, "TGit API could not be reached");
    }
    if (response.status === 401 || response.status === 403) throw authenticationError();
    if (!response.ok) throw new TgitApiError(response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TgitApiError(0, "TGit API returned invalid JSON");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new TgitApiError(0, "TGit API returned an invalid response");
    return parsed.data;
  }

  async function repo(cwd: string): Promise<string> {
    const remote = await resolveRemoteUrl(cwd);
    const location = remote ? parseGitRemoteLocation(remote) : null;
    if (!location || location.host !== "git.woa.com") {
      throw new TgitApiError(0, "TGit requires a git.woa.com remote");
    }
    return location.path;
  }

  function projectPath(project: string): string {
    return `/projects/${encodeURIComponent(project)}`;
  }

  async function mrByNumber(project: string, number: number): Promise<TgitMr> {
    return get(`${projectPath(project)}/merge_request/iid/${number}`, mrSchema);
  }

  async function list<T>(path: string, schema: z.ZodType<T>, limit: number): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const separator = path.includes("?") ? "&" : "?";
      const batch = await get(
        `${path}${separator}per_page=${PAGE_SIZE}&page=${page}`,
        z.array(schema),
      );
      items.push(...batch);
      if (items.length >= limit || batch.length < PAGE_SIZE) return items.slice(0, limit);
    }
    return items.slice(0, limit);
  }

  async function checks(project: string, mr: TgitMr) {
    const found: TgitCheck[] = [];
    const seen = new Set<number>();
    let aggregate: z.infer<typeof checksSchema> | null = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const path = `${projectPath(project)}/commits/${encodeURIComponent(mr.source_commit)}/status?target_branch=${encodeURIComponent(mr.target_branch)}&per_page=${PAGE_SIZE}&page=${page}`;
      let data: z.infer<typeof checksSchema>;
      try {
        data = await get(path, checksSchema);
      } catch (error) {
        // TGit returns 404 when a commit has no status records. Preserve the MR
        // gate below so absent records cannot turn a blocked gate green.
        if (error instanceof TgitApiError && error.status === 404 && page === 1)
          return { records: [], aggregate: null };
        throw error;
      }
      if (data.sha !== mr.source_commit)
        throw new TgitApiError(0, "TGit checks changed during refresh");
      if (
        aggregate &&
        (data.state !== aggregate.state ||
          data.block !== aggregate.block ||
          data.total_count !== aggregate.total_count)
      ) {
        throw new TgitApiError(0, "TGit checks changed during refresh");
      }
      aggregate = data;
      for (const check of data.statuses) {
        if (seen.has(check.id))
          throw new TgitApiError(0, "TGit returned duplicate check identities");
        seen.add(check.id);
        if (check.target_branches.length === 0 || check.target_branches.includes(mr.target_branch))
          found.push(check);
      }
      if (seen.size === data.total_count) return { records: found, aggregate };
      if (seen.size > data.total_count || data.statuses.length === 0) break;
    }
    throw new TgitApiError(0, "TGit checks pagination was incomplete");
  }

  async function listMrs(project: string, query: string | undefined, limit: number) {
    const params = new URLSearchParams({ state: "opened", order_by: "updated_at", sort: "desc" });
    if (query) params.set("search", query);
    return list(`${projectPath(project)}/merge_requests?${params}`, mrSchema, limit);
  }

  async function listIssues(
    cwd: string,
    query: string | undefined,
    limit: number,
  ): Promise<IssueSummary[]> {
    const project = await repo(cwd);
    const params = new URLSearchParams({ state: "opened" });
    if (query) params.set("search", query);
    const issues = await list(`${projectPath(project)}/issues?${params}`, issueSchema, limit);
    return issues.map((issue) => ({
      number: issue.iid,
      title: issue.title,
      url: `https://git.woa.com/${project}/-/issues/${issue.iid}`,
      state: issue.state,
      body: issue.description || null,
      labels: issue.labels,
      updatedAt: issue.updated_at,
      projectPath: project,
    }));
  }

  async function searchMrNumber(project: string, number: number): Promise<TgitMr[]> {
    try {
      return [await mrByNumber(project, number)];
    } catch (error) {
      if (error instanceof TgitApiError && error.status === 404) return [];
      throw error;
    }
  }

  async function currentMr(
    project: string,
    input: Parameters<ForgeService["getCurrentPullRequestStatus"]>[0],
  ): Promise<TgitMr | null> {
    const target = await get(projectPath(project), projectSchema);
    const params = new URLSearchParams({
      source_branch: input.headRef,
      order_by: "updated_at",
      sort: "desc",
    });
    const mrs = await list(
      `${projectPath(project)}/merge_requests?${params}`,
      mrSchema,
      PAGE_SIZE * MAX_PAGES,
    );
    const candidates: TgitMr[] = [];
    for (const candidate of mrs) {
      if (candidate.source_branch !== input.headRef) continue;
      const expectedOwner = input.headRepositoryOwner;
      if (!expectedOwner) {
        if (candidate.source_project_id === target.id) candidates.push(candidate);
        continue;
      }
      const source = await get(`/projects/${candidate.source_project_id}`, projectSchema);
      const owner = source.path_with_namespace.split("/").slice(0, -1).join("/");
      if (owner === expectedOwner) candidates.push(candidate);
    }
    const mr =
      candidates.find(isOpen) ??
      candidates.find((candidate) => input.headSha && candidate.source_commit === input.headSha);
    if (!mr) return null;
    const detail = await mrByNumber(project, mr.iid);
    const terminalMatches = isOpen(detail) || detail.source_commit === input.headSha;
    const sameHead =
      detail.source_commit === mr.source_commit &&
      detail.source_project_id === mr.source_project_id &&
      detail.source_branch === input.headRef &&
      terminalMatches;
    if (!sameHead) throw new TgitApiError(0, "TGit MR changed during refresh");
    return detail;
  }

  async function unsupported(): Promise<never> {
    throw new TgitUnsupportedOperationError();
  }

  const service: ForgeService = {
    async isAuthenticated({ cwd }) {
      if (!readToken()) return false;
      try {
        await repo(cwd);
        await get("/user", z.object({ id: idSchema }));
        return true;
      } catch {
        return false;
      }
    },
    async listPullRequests(input) {
      const project = await repo(input.cwd);
      const mrs = await listMrs(project, input.query, boundedLimit(input.limit));
      return mrs.map((mr) => summary(mr, project));
    },
    listIssues(input) {
      return listIssues(input.cwd, input.query, boundedLimit(input.limit));
    },
    async getPullRequest(input) {
      const project = await repo(input.cwd);
      return summary(await mrByNumber(project, input.number), project);
    },
    async getPullRequestHeadRef(input) {
      const project = await repo(input.cwd);
      return (await mrByNumber(project, input.number)).source_branch;
    },
    async getPullRequestCheckoutTarget(input): Promise<PullRequestCheckoutTarget> {
      const project = await repo(input.cwd);
      const mr = await mrByNumber(project, input.number);
      const source = await get(`/projects/${mr.source_project_id}`, projectSchema);
      const owner = source.path_with_namespace.split("/").slice(0, -1).join("/");
      const headRepositorySshUrl = `git@git.woa.com:${source.path_with_namespace}.git`;
      const headRepositoryUrl = `https://git.woa.com/${source.path_with_namespace}.git`;
      const remote = await resolveRemoteUrl(input.cwd);
      const transport = remote ? parseGitRemoteLocation(remote)?.transport : undefined;
      const useSsh = transport === "scp" || transport === "ssh";
      const sourceRemote = useSsh ? headRepositorySshUrl : headRepositoryUrl;
      const isCrossRepository = mr.source_project_id !== mr.target_project_id;
      const checkoutRemote = isCrossRepository ? sourceRemote : "origin";
      return {
        number: mr.iid,
        baseRefName: mr.target_branch,
        headRefName: mr.source_branch,
        headOwnerLogin: owner,
        headRepositorySshUrl,
        headRepositoryUrl,
        isCrossRepository,
        checkoutRefs: [{ remoteName: checkoutRemote, remoteRef: `refs/heads/${mr.source_branch}` }],
      };
    },
    buildPrLocalBranchName({ headRef, checkoutTarget }) {
      return buildForkLocalBranchName({ headRef, ...checkoutTarget });
    },
    async getCurrentPullRequestStatus(input): Promise<CurrentPullRequestStatus | null> {
      if (!readToken()) throw authenticationError();
      const project = await repo(input.cwd);
      const detail = await currentMr(project, input);
      if (!detail) return null;
      const snapshot = await checks(project, detail);
      const normalized: PullRequestCheck[] = snapshot.records.map((check) => ({
        name: check.context,
        status: checkStatus(check.state),
        url: safeWebUrl(check.target_url),
        checkRunId: check.id,
      }));
      const gateStatuses = [gateStatus(detail.commit_check_state, detail.commit_check_block)];
      if (snapshot.aggregate)
        gateStatuses.push(gateStatus(snapshot.aggregate.state, snapshot.aggregate.block));
      appendBlockingGate({ checks: normalized, gateStatuses, url: mrUrl(project, detail.iid) });
      const review = await get(
        `${projectPath(project)}/merge_request/${detail.id}/review`,
        reviewSchema,
      );
      let mergeable: CurrentPullRequestStatus["mergeable"] = "UNKNOWN";
      if (isOpen(detail)) {
        const branch = await get(
          `${projectPath(project)}/repository/branches/${encodeURIComponent(detail.target_branch)}`,
          branchSchema,
        );
        const conflict = await get(
          `${projectPath(project)}/merge_request/${detail.id}/merge_conflict_check`,
          conflictSchema,
        );
        const currentConflict =
          conflict.base_commit === detail.source_commit &&
          conflict.target_commit === branch.commit.id;
        if (currentConflict && conflict.has_conflicts === true) mergeable = "CONFLICTING";
        if (currentConflict && conflict.has_conflicts === false) mergeable = "MERGEABLE";
      }
      const after = await mrByNumber(project, detail.iid);
      if (
        after.source_commit !== detail.source_commit ||
        after.target_branch !== detail.target_branch ||
        after.updated_at !== detail.updated_at ||
        after.state !== detail.state
      ) {
        throw new TgitApiError(0, "TGit MR changed during refresh");
      }
      const segments = project.split("/");
      return {
        ...summary(detail, project),
        repoOwner: segments.slice(0, -1).join("/"),
        repoName: segments.at(-1),
        headSha: detail.source_commit,
        isMerged: detail.state === "merged",
        isDraft: detail.work_in_progress,
        mergeable,
        checks: normalized,
        checksStatus: computeChecksStatus(normalized),
        reviewDecision: reviewDecision(review.state),
        forgeSpecific: { forge: "tgit", readOnly: true },
      };
    },
    async getPullRequestTimeline(input): Promise<PullRequestTimeline> {
      const project = await repo(input.cwd);
      const mr = await mrByNumber(project, input.prNumber);
      const comments = await list(
        `${projectPath(project)}/merge_request/${mr.id}/comments`,
        commentSchema,
        PAGE_SIZE * MAX_PAGES,
      );
      const url = mrUrl(project, mr.iid);
      const items: PullRequestTimelineItem[] = [];
      function appendComment(comment: z.infer<typeof commentSchema>, rootId: number): void {
        items.push({
          id: `tgit-comment-${comment.id}`,
          kind: "comment",
          author: comment.author.username,
          authorUrl: `https://git.woa.com/${encodeURIComponent(comment.author.username)}`,
          avatarUrl: safeWebUrl(comment.author.avatar_url),
          body: comment.body,
          createdAt: parseOptionalTime(comment.created_at),
          url: `${url}#note_${comment.id}`,
          threadId: `tgit-thread-${rootId}`,
        });
        for (const reply of comment.comments) appendComment(reply, rootId);
      }
      for (const comment of comments) appendComment(comment, comment.parent_id ?? comment.id);
      return {
        prNumber: mr.iid,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        items: items.sort(compareTimelineItems),
        truncated: comments.length === PAGE_SIZE * MAX_PAGES,
        error: null,
      };
    },
    async getCheckDetails(input): Promise<CheckDetails> {
      if (!input.changeRequestNumber || !input.checkRunId)
        throw new TgitApiError(0, "TGit check details require an MR number and check id");
      const project = await repo(input.cwd);
      const mr = await mrByNumber(project, input.changeRequestNumber);
      const snapshot = await checks(project, mr);
      const check = snapshot.records.find((record) => record.id === input.checkRunId);
      if (!check)
        throw new TgitApiError(404, "TGit check does not belong to the MR's current source commit");
      const url = safeWebUrl(check.target_url);
      return {
        checkRunId: check.id,
        name: check.context,
        status: check.state,
        conclusion: check.state,
        url,
        detailsUrl: url,
        output: { summary: check.description, text: check.detail },
        annotations: [],
        failedJobs: [],
        truncated: false,
      };
    },
    async searchIssuesAndPrs(input): Promise<SearchResult> {
      if (!readToken()) return createUnavailableSearchResult("unauthenticated");
      const project = await repo(input.cwd);
      const kinds = normalizeForgeSearchKinds(input.kinds);
      const limit = boundedLimit(input.limit);
      const number = input.query.trim().match(/^[#!]?(\d+)$/u)?.[1];
      const items: SearchResult["items"] = [];
      try {
        if (kinds.includes("change_request")) {
          const mrs = number
            ? await searchMrNumber(project, Number(number))
            : await listMrs(project, input.query, limit);
          for (const mr of mrs)
            items.push({ ...summary(mr, project), kind: "change_request", forge: "tgit" });
        }
        if (kinds.includes("issue")) {
          const query = number ? `iid=${number}` : `search=${encodeURIComponent(input.query)}`;
          const issues = await list(`${projectPath(project)}/issues?${query}`, issueSchema, limit);
          items.push(
            ...issues.map((issue) => ({
              kind: "issue" as const,
              forge: "tgit",
              number: issue.iid,
              title: issue.title,
              url: `https://git.woa.com/${project}/-/issues/${issue.iid}`,
              state: issue.state,
              body: issue.description || null,
              labels: issue.labels,
              projectPath: project,
              updatedAt: issue.updated_at,
            })),
          );
        }
      } catch (error) {
        if (error instanceof ForgeAuthenticationError)
          return createUnavailableSearchResult("unauthenticated");
        throw error;
      }
      return { items: items.slice(0, limit), featuresEnabled: true, authState: "authenticated" };
    },
    createPullRequest: unsupported,
    mergePullRequest: unsupported,
    enablePullRequestAutoMerge: unsupported,
    disablePullRequestAutoMerge: unsupported,
    invalidate() {},
  };
  return service;
}

interface BlockingGateInput {
  checks: PullRequestCheck[];
  gateStatuses: PullRequestCheckStatus[];
  url: string;
}

function appendBlockingGate({ checks, gateStatuses, url }: BlockingGateInput): void {
  const visibleStatus = computeChecksStatus(checks);
  if (visibleStatus === "failure") return;
  if (gateStatuses.includes("failure")) {
    checks.push({ name: "TGit CI gate", status: "failure", url });
  } else if (gateStatuses.includes("pending") && visibleStatus !== "pending") {
    // An additional gate row only explains a blocker absent from the concrete
    // checks; mirrored aggregates must not inflate the check counts.
    checks.push({ name: "TGit CI gate", status: "pending", url });
  }
}

function gateStatus(state: string, blocked: boolean | null | undefined): PullRequestCheckStatus {
  const status = checkStatus(state);
  if (status === "failure") return status;
  return state === "success" && blocked === false ? "success" : "pending";
}

function reviewDecision(state: string): CurrentPullRequestStatus["reviewDecision"] {
  switch (state) {
    case "approved":
      return "approved";
    case "denied":
    case "rejected":
      return "changes_requested";
    default:
      return "pending";
  }
}
