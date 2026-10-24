import { test } from "vitest";
import assert from "node:assert/strict";
import { MagpieBridge, type Transport } from "./magpie.js";
import { allowedSignInUrl, projectSignIn, projectSnapshot, validCallback } from "./projection.js";

const secret = "DO_NOT_EXPOSE_CREDENTIAL";
const providers = {
  providers: [
    {
      id: "ichat",
      name: "iChat",
      ready: true,
      exposed: 12,
      key: secret,
      headers: { Authorization: secret },
    },
    {
      id: "codex",
      name: "ChatGPT",
      ready: true,
      account: {
        user: "owner@example.com",
        plan: "Plus",
        auth: secret,
        logins: [
          {
            user: "owner@example.com",
            plan: "Plus",
            active: true,
            on: true,
            lapsed: "",
            token: secret,
          },
          { user: "expired@example.com", on: true, lapsed: secret },
        ],
      },
    },
  ],
};
const groups = {
  groups: [
    {
      id: "gpt-test",
      name: "GPT",
      members: ["codex/gpt-test", "ichat/gpt-test"],
      routing: "order",
      affinity: "off",
      ready: true,
      memberInfo: [
        { id: "codex/gpt-test", ready: false },
        { id: "ichat/gpt-test", ready: true },
      ],
    },
  ],
};
const quotas = {
  data: [
    {
      provider: "codex",
      name: "ChatGPT",
      user: "owner@example.com",
      error: secret,
      windows: [
        { name: "5h", used: 25, remaining: 75, resetsAt: "2026-10-23T00:00:00Z", token: secret },
      ],
    },
  ],
};
const waiting = {
  id: "test-flow",
  agent: "codex",
  state: "waiting",
  url: "https://auth.openai.com/oauth/authorize?state=test",
  pasteCallback: true,
  verifier: secret,
  token: secret,
};

test("snapshots project credentials out and preserve priority, status and percent units", () => {
  const out = projectSnapshot(providers, groups, quotas);
  assert.equal(JSON.stringify(out).includes(secret), false);
  assert.equal(out.providers[0].modelCount, 12);
  assert.equal(out.providers[1].modelCount, 0);
  assert.equal(out.groups[0].members[0].id, "codex/gpt-test");
  assert.equal(out.groups[0].members[0].ready, false);
  assert.equal(out.groups[0].members[1].ready, true);
  assert.equal(out.quotas[0].windows[0].used, 25);
  assert.equal(out.providers[1].accounts[1].needsLogin, true);
  assert.equal(out.providers[1].accounts[0].enabled, true);
});

test("upstream auth failures and opaque tokens do not cross the RPC boundary", () => {
  const out = projectSignIn({ ...waiting, error: secret });
  assert.equal(JSON.stringify(out).includes(secret), false);
  assert.equal(out.pasteCallback, true);
});

test("browser sign-in links only open known HTTPS vendor hosts", () => {
  for (const url of [
    "https://auth.openai.com/oauth/authorize",
    "https://claude.ai/oauth/authorize",
  ])
    assert.equal(allowedSignInUrl(url), true);
  for (const url of [
    "javascript:alert(1)",
    "http://auth.openai.com/",
    "https://auth.openai.com.evil.test/",
    "https://user:pass@auth.openai.com/",
    "https://auth.openai.com:8443/",
    "http://127.0.0.1:3425/",
  ]) {
    assert.equal(allowedSignInUrl(url), false);
    assert.throws(() => projectSignIn({ ...waiting, url }));
  }
});

test("callback rejects unrelated hosts and invalid Codex state, supports Claude code form", () => {
  const flow = projectSignIn(waiting);
  assert.equal(
    validCallback("http://localhost:1455/auth/callback?code=test&state=expected", flow),
    true,
  );
  for (const url of [
    "http://localhost:1455/auth/callback?code=test",
    "http://localhost:9999/auth/callback?code=test&state=x",
    "http://example.com:1455/auth/callback?code=test&state=x",
    "code#state",
  ])
    assert.equal(validCallback(url, flow), false);
  assert.equal(validCallback("code#state", { ...flow, agent: "claude", pasteCode: true }), true);
});

test("bridge limits actions to its own flow; forwards valid callback then cancels", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const send: Transport = async (path, body) => {
    calls.push({ path, body });
    return path.endsWith("callback") || path.endsWith("cancel") ? {} : waiting;
  };
  const bridge = new MagpieBridge(send);
  const flow = await bridge.begin("codex");
  assert.equal((await bridge.poll(flow.id)).state, "waiting");
  await assert.rejects(bridge.poll("someone-elses-flow"));
  await assert.rejects(bridge.submit(flow.id, "http://example.com/?code=test"));
  assert.equal(calls.length, 2);
  const callback = "http://localhost:1455/auth/callback?code=test&state=expected";
  await bridge.submit(flow.id, callback);
  assert.deepEqual(calls[2], { path: "/api/signin/test-flow/callback", body: { url: callback } });
  await bridge.cancel(flow.id);
  assert.equal(calls[3].path, "/api/signin/test-flow/cancel");
});

test("starting another provider cannot replace a pending login", async () => {
  const bridge = new MagpieBridge(async () => waiting);
  await bridge.begin("codex");
  await assert.rejects(bridge.begin("claude"), /完成或取消/);
});

test("offline state is actionable and never returns upstream error contents", async () => {
  const bridge = new MagpieBridge(async () => {
    throw new Error(secret);
  });
  const result = await bridge.snapshot();
  assert.equal(result.available, false);
  assert.match(result.issue!, /启动服务/);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("quota failure keeps providers and routes available with an explicit warning", async () => {
  const bridge = new MagpieBridge(async (path) => {
    if (path === "/api/providers") return providers;
    if (path === "/api/groups") return groups;
    throw new Error(secret);
  });
  const result = await bridge.snapshot(true);
  assert.equal(result.available, true);
  assert.equal(result.groups.length, 1);
  assert.match(result.issue!, /额度读取失败/);
});
