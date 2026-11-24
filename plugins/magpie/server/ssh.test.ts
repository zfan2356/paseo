import { spawn } from "node:child_process";
import { afterEach, expect, test } from "vitest";
import { SshBridge, sshArguments, sshConfig } from "./ssh.js";

const config = {
  host: "magpie-host",
  port: 22,
  directory: "/srv/paseo/plugins/magpie",
  bun: "bun",
};
const bridges: SshBridge[] = [];
afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.dispose();
});

test("SSH settings reject option injection and quote configured remote paths", () => {
  expect(sshConfig({})).toBeNull();
  for (const host of ["-oProxyCommand=bad", "host;bad", "host\nother"]) {
    expect(() =>
      sshConfig({ PASEO_MAGPIE_SSH_HOST: host, PASEO_MAGPIE_REMOTE_DIR: "/srv/plugin" }),
    ).toThrow();
  }
  expect(() =>
    sshConfig({
      PASEO_MAGPIE_SSH_HOST: "host",
      PASEO_MAGPIE_SSH_PORT: "65536",
      PASEO_MAGPIE_REMOTE_DIR: "/srv/plugin",
    }),
  ).toThrow();
  const command = sshArguments({
    ...config,
    directory: "/srv/a'b $(touch bad)",
    bun: "/bin/bun with spaces",
  }).at(-1)!;
  expect(command).toBe(
    "cd '/srv/a'\\''b $(touch bad)' && exec '/bin/bun with spaces' run server/remote-entry.ts",
  );
});

test("one worker owns sign-in across concurrent requests", async () => {
  let starts = 0;
  // A real subprocess speaking the wire protocol, without network or account access.
  const bridge = new SshBridge(config, () => {
    starts++;
    return spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { createInterface } from 'node:readline';
      let flow = null;
      createInterface({input:process.stdin}).on('line', line => {
        const {id, operation} = JSON.parse(line);
        if (operation.method === 'begin') flow = {id:'owned', agent:operation.agent, state:'waiting', url:'https://auth.openai.com/', pasteCallback:true, pasteCode:false};
        process.stdout.write(JSON.stringify({id,value:flow})+'\\n');
      });
    `,
      ],
      { stdio: "pipe" },
    );
  });
  bridges.push(bridge);
  const flow = await bridge.begin("codex");
  expect(flow.id).toBe("owned");
  const results = await Promise.all([bridge.poll(flow.id), bridge.poll(flow.id)]);
  expect(results).toEqual([flow, flow]);
  expect(starts).toBe(1);
});

test("a failed worker rejects pending calls without diagnostics and the next call reconnects", async () => {
  let starts = 0;
  const bridge = new SshBridge(config, () => {
    starts++;
    return spawn(
      process.execPath,
      ["-e", "process.stderr.write('DO_NOT_EXPOSE_CREDENTIAL'); process.exit(1)"],
      { stdio: "pipe" },
    );
  });
  bridges.push(bridge);
  const results = await Promise.allSettled([bridge.snapshot(), bridge.start()]);
  for (const result of results) {
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("Expected rejection");
    expect(result.reason.message).toMatch(/SSH/);
    expect(result.reason.message).not.toContain("DO_NOT_EXPOSE");
  }
  await expect(bridge.snapshot()).rejects.toThrow(/SSH/);
  expect(starts).toBe(2);
});
