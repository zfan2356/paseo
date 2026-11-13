import { FORGE_DEFINITIONS } from "@getpaseo/protocol/forge-manifest";
import type { LinkedChangeRequest } from "@getpaseo/protocol/agent-change-requests";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { parseGitRemoteLocation, type GitRemoteLocation } from "@getpaseo/protocol/git-remote";

export type ChangeRequestIdentity = Pick<
  LinkedChangeRequest,
  "key" | "forge" | "host" | "projectPath" | "number" | "url"
>;
const ROUTES: Record<string, { pattern: RegExp; route: string; pair?: boolean }> = {
  github: { pattern: /^\/(.+)\/pull\/([1-9]\d*)\/?$/, route: "pull", pair: true },
  gitlab: { pattern: /^\/(.+)\/-\/merge_requests\/([1-9]\d*)\/?$/, route: "-/merge_requests" },
  tgit: { pattern: /^\/(.+?)\/(?:-\/)?merge_requests\/([1-9]\d*)\/?$/, route: "merge_requests" },
  gitea: { pattern: /^\/(.+)\/pulls\/([1-9]\d*)\/?$/, route: "pulls", pair: true },
};
ROUTES.forgejo = ROUTES.gitea;
ROUTES.codeberg = ROUTES.gitea;

function safeUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !/^https:\/\/[^/?#@]+\//i.test(value) ||
      url.port ||
      url.search ||
      url.hash
    )
      return null;
    // URL normalizes dot segments. Reject them in the original input as well.
    if (/%|\\/.test(value) || value.split("/").some((part) => part === "." || part === ".."))
      return null;
    return url;
  } catch {
    return null;
  }
}

export function parseChangeRequestUrl(value: string, forge?: string): ChangeRequestIdentity | null {
  const url = safeUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  forge ??= FORGE_DEFINITIONS.find((item) => item.cloudHosts?.includes(host))?.id;
  if (!forge) return null;
  const grammar = ROUTES[forge];
  const match = grammar?.pattern.exec(url.pathname);
  if (!match) return null;
  const segments = match[1].split("/");
  if (
    segments.length < 2 ||
    segments.some((part) => !/^[\w.-]+$/.test(part) || part === "." || part === "..")
  )
    return null;
  if (grammar.pair && segments.length !== 2) return null;
  const projectPath = forge === "github" ? match[1].toLowerCase() : match[1];
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number)) return null;
  return {
    key: JSON.stringify([forge, host, projectPath, number]),
    forge,
    host,
    projectPath,
    number,
    url: `https://${host}/${projectPath}/${grammar.route}/${number}`,
  };
}

// Recognize a single argv invocation. Shell syntax is never interpreted or executed.
export function standaloneArgv(command: string): string[] | null {
  const tokens: string[] = [];
  let token = "",
    quote = "",
    started = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) {
        quote = "";
        continue;
      }
      if (quote === '"' && /[$\\\x60]/.test(char)) return null;
      token += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/[;&|<>$\x60\\(){}\n\r]/.test(char)) return null;
    else if (/\s/.test(char)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
    } else {
      token += char;
      started = true;
    }
  }
  if (quote) return null;
  if (started) tokens.push(token);
  return tokens;
}

const SWITCHES = new Set([
  "--draft",
  "--fill",
  "--fill-first",
  "--fill-verbose",
  "--no-maintainer-edit",
  "--yes",
  "-y",
]);
const VALUES = new Set([
  "--title",
  "-t",
  "--body",
  "-b",
  "--body-file",
  "-F",
  "--description",
  "-d",
  "--base",
  "-B",
  "--head",
  "-H",
  "--target",
  "--source-branch",
  "--target-branch",
  "--reviewer",
  "-r",
  "--assignee",
  "-a",
  "--label",
  "-l",
  "--milestone",
  "-m",
  "--project",
  "-p",
]);
const COMMANDS: Record<string, string> = {
  "gh pr create": "github",
  "glab mr create": "gitlab",
  "gw mr create": "tgit",
};

export function isChangeRequestCreateCommand(command: string): boolean {
  const args = standaloneArgv(command);
  return args !== null && COMMANDS[args.slice(0, 3).join(" ")] !== undefined;
}

function repositoryArgument(repo: string, forge: string): GitRemoteLocation | null {
  if (repo.includes("://")) return parseGitRemoteLocation(repo);
  if (repo.split("/").length > 2) return parseGitRemoteLocation(`https://${repo}`);
  const host = forge === "github" ? "github.com" : "gitlab.com";
  return parseGitRemoteLocation(`https://${host}/${repo}`);
}

function commandTarget(
  args: string[],
  forge: string,
  remoteUrl: string | null,
): GitRemoteLocation | null {
  let target = remoteUrl ? parseGitRemoteLocation(remoteUrl) : null;
  let json = false;
  for (let i = 3; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    if (flag === "--json" && forge === "tgit" && inline === undefined) {
      json = true;
      continue;
    }
    if (SWITCHES.has(flag) && inline === undefined) continue;
    if (flag === "--repo" || flag === "-R") {
      if (forge === "tgit") return null;
      const repo = inline ?? args[++i];
      if (!repo) return null;
      target = repositoryArgument(repo, forge);
      if (!target) return null;
    } else if (VALUES.has(flag)) {
      if (inline === undefined && args[++i] === undefined) return null;
    } else return null;
  }
  if (forge === "tgit" && !json) return null;
  return target;
}

function createdIdentity(output: string, forge: string): ChangeRequestIdentity | null {
  if (forge !== "tgit") {
    const urls = output.match(/https:\/\/[^\s<>"']+/g) ?? [];
    if (urls.length !== 1) return null;
    return parseChangeRequestUrl(urls[0], forge);
  }
  try {
    const value: unknown = parseGwCreateJson(output);
    if (
      !value ||
      typeof value !== "object" ||
      !("iid" in value) ||
      !("web_url" in value) ||
      typeof value.web_url !== "string"
    )
      return null;
    const candidate = parseChangeRequestUrl(value.web_url, forge);
    if (candidate?.number !== value.iid) return null;
    return candidate;
  } catch {
    return null;
  }
}

function parseGwCreateJson(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // gw waits for its automatic git push, then prints one json.Marshal line.
    // Push output may precede that line even with --json. Only the final complete
    // JSON record is evidence; a URL in the push log cannot add a link.
    const lastLine = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
    return JSON.parse(lastLine);
  }
}

export function createdChangeRequest(
  detail: Extract<ToolCallDetail, { type: "shell" }>,
  remoteUrl: string | null,
): ChangeRequestIdentity | null {
  if (detail.exitCode !== 0 || !detail.output) return null;
  const args = standaloneArgv(detail.command);
  if (!args) return null;
  const forge = COMMANDS[args.slice(0, 3).join(" ")];
  if (!forge) return null;
  const target = commandTarget(args, forge, remoteUrl);
  if (!target) return null;
  const candidate = createdIdentity(detail.output, forge);
  if (!candidate) return null;
  const project = forge === "github" ? target.path.toLowerCase() : target.path;
  return candidate.host === target.host.toLowerCase() && candidate.projectPath === project
    ? candidate
    : null;
}
