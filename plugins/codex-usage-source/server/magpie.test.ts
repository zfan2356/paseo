import { expect, test } from "vitest";
import { UsageSourceRegistry } from "../../../packages/server/src/server/plugins/usage-sources/index.js";
import { MagpieCodexUsage, usageInputSchema } from "./magpie.js";
import { managementTransport, type Transport } from "./management.js";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const providers = {
  providers: [
    {
      id: "codex",
      account: {
        logins: [
          { user: "first@example.com", plan: "promax", on: true },
          { user: "second@example.com", plan: "plus", on: true },
          { user: "old@example.com", on: false, lapsed: "expired" },
          { user: "paused@example.com", on: true, paused: true },
        ],
      },
    },
  ],
};
const quotas = [
  {
    provider: "codex",
    user: "first@example.com",
    plan: "promax",
    windows: [{ name: "7 days", used: 53, resetsAt: "2026-11-13T15:30:00Z" }],
    token: "fixture-private-token",
  },
  {
    provider: "codex",
    user: "second@example.com",
    plan: "plus",
    windows: [
      { name: "5 hours", used: 10, resetsAt: "2026-11-08T10:00:00Z" },
      { name: "7 days", used: 3 },
    ],
    balance: "12.5 credits",
  },
];
const send: Transport = async (path) => (path === "/api/providers" ? providers : quotas);

test("reads both management runtimes without sending credentials to the client", async () => {
  const home = await mkdtemp(join(tmpdir(), "paseo-magpie-usage-"));
  const key = "fixture-management-secret-123456";
  const server = createServer((request, response) => {
    if (request.headers.cookie !== `magpie_web_${port}=${key}`) {
      response.writeHead(401).end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(request.url === "/api/providers" ? providers : quotas));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected loopback server");
  const port = address.port;
  const origin = `http://127.0.0.1:${port}`;
  const config = join(home, ".config/magpie/paseo-web.json");
  const keyFile = join(home, ".local/state/magpie/web-key");
  try {
    await mkdir(dirname(config), { recursive: true });
    await mkdir(dirname(keyFile), { recursive: true });
    await writeFile(keyFile, key);
    for (const runtime of ["legacy", "daemon"]) {
      await writeFile(config, JSON.stringify({ runtime, managementUrl: origin }));
      const usage = new MagpieCodexUsage(
        managementTransport({ home, web: async () => `${origin}/?k=${key}` }),
      );
      const accounts = await usage.discover({ kind: "global" }, []);
      expect(accounts).toHaveLength(2);
      const report = await usage.fetch({ store: "magpie", user: "second@example.com" });
      expect(report).toMatchObject({ status: "available", planLabel: "plus" });
      expect(JSON.stringify({ accounts, report })).not.toContain(key);
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await rm(home, { recursive: true, force: true });
  }
});

test("lists both enabled subscriptions once and preserves the native account's identity", async () => {
  const usage = new MagpieCodexUsage(send);
  const native = {
    key: "native-account",
    label: "first@example.com",
    harness: "Codex",
    input: { route: { store: "codex", path: "/fixture/auth.json" } },
  };
  const accounts = await usage.discover({ kind: "global" }, [native]);
  expect(accounts).toHaveLength(3);
  expect(accounts[0]).toMatchObject({ key: native.key, label: native.label, harness: "Magpie" });
  expect(accounts[1]).toMatchObject({ label: "second@example.com", harness: "Magpie" });
  expect(accounts[1].key).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
  expect(accounts[1].key).not.toContain("example.com");
  expect(accounts[2]).toEqual(native);
  const registry = new UsageSourceRegistry();
  registry.register({
    id: "codex",
    label: "Codex",
    discover: async () => accounts,
    fetch: async (input) => {
      const { route } = usageInputSchema.parse(input);
      if (route.store !== "magpie") throw new Error("Magpie should be preferred");
      return usage.fetch(route);
    },
  });
  const reports = await registry.listReports();
  expect(reports).toHaveLength(2);
  expect(reports.map((entry) => entry.report)).toMatchObject([
    {
      status: "available",
      planLabel: "promax",
      windows: [{ id: "weekly", usedPct: 53, remainingPct: 47 }],
    },
    {
      status: "available",
      planLabel: "plus",
      windows: [
        { id: "five_hour", usedPct: 10 },
        { id: "weekly", usedPct: 3 },
      ],
      balances: [{ remaining: 12.5, unit: "credits" }],
    },
  ]);
  expect(JSON.stringify(reports)).not.toContain("fixture-private-token");
});

test("refreshes only the selected account and retains its reset timestamp", async () => {
  const requests: string[] = [];
  const usage = new MagpieCodexUsage(async (path, body) => {
    requests.push(path);
    expect(body).toEqual({});
    return quotas;
  });
  const report = await usage.fetch({ store: "magpie", user: "first@example.com" });
  expect(requests).toEqual(["/api/usage/quotas/refresh?provider=codex&user=first%40example.com"]);
  expect(report).toMatchObject({ windows: [{ resetsAt: "2026-11-13T15:30:00Z" }] });
});

test("keeps normal discovery when Magpie is absent and retains discovered accounts on outages", async () => {
  let online = false;
  const usage = new MagpieCodexUsage(async () => {
    if (!online) throw new Error("fixture-private-credential");
    return providers;
  });
  expect(await usage.discover({ kind: "global" }, [])).toEqual([]);
  online = true;
  expect(await usage.discover({ kind: "global" }, [])).toHaveLength(2);
  online = false;
  await expect(usage.discover({ kind: "global" }, [])).rejects.toThrow("Magpie");
  const report = await usage.fetch({ store: "magpie", user: "second@example.com" });
  expect(report.status).toBe("error");
  expect(JSON.stringify(report)).not.toContain("fixture-private-credential");
});

test("does not attribute a routed session to every subscription account", async () => {
  const usage = new MagpieCodexUsage(async () => {
    throw new Error("must not query");
  });
  expect(await usage.discover({ kind: "session", provider: "codex", env: {} }, [])).toEqual([]);
});

test("does not present missing or failed quotas as zero usage", async () => {
  const usage = new MagpieCodexUsage(async () => [
    { provider: "codex", user: "first@example.com", error: "fixture-private-token", windows: [] },
  ]);
  for (const user of ["first@example.com", "missing@example.com"]) {
    const report = await usage.fetch({ store: "magpie", user });
    expect(report.status).toBe("error");
    expect(JSON.stringify(report)).not.toContain("fixture-private-token");
  }
});
