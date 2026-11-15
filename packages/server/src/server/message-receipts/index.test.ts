import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { MessageReceipts } from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-requests-"));
  directories.push(directory);
  return { directory, requests: new MessageReceipts(directory) };
}

test("message retries survive reconstruction without submitting twice", async () => {
  const { requests, directory } = await fixture();
  let deliveries = 0;
  const input = {
    agentId: "agent",
    messageId: "arrival",
    request: { text: "hello" },
    send: async () => {
      deliveries++;
    },
  };
  await Promise.all([requests.send(input), requests.send(input)]);
  await new MessageReceipts(directory).send(input);
  expect(deliveries).toBe(1);
  await requests.send({ ...input, agentId: "another" });
  expect(deliveries).toBe(2);
});

test("ambiguous provider delivery is never blindly replayed after restart", async () => {
  const { requests, directory } = await fixture();
  let deliveries = 0;
  const input = {
    agentId: "agent",
    messageId: "arrival",
    request: {},
    send: async () => {
      deliveries++;
      throw new Error("connection lost");
    },
  };
  await expect(requests.send(input)).rejects.toThrow("connection lost");
  await expect(new MessageReceipts(directory).send(input)).rejects.toThrow(
    "agent_request_outcome_unknown",
  );
  expect(deliveries).toBe(1);
});

test("failed local message preparation does not leave an ambiguous receipt", async () => {
  const { requests, directory } = await fixture();
  let available = false;
  let sends = 0;
  const input = {
    agentId: "agent",
    messageId: "message",
    request: {},
    prepare: async () => {
      if (!available) throw new Error("load failed");
    },
    send: async () => {
      sends++;
    },
  };
  await expect(requests.send(input)).rejects.toThrow("load failed");
  available = true;
  await new MessageReceipts(directory).send(input);
  available = false;
  await requests.send(input);
  expect(sends).toBe(1);
});

test("a proven no-effect rejection removes the receipt so the same id can retry", async () => {
  const { requests, directory } = await fixture();
  let busy = true;
  let sends = 0;
  const input = {
    agentId: "agent",
    messageId: "message",
    request: {},
    isProvenNoEffect: (error: unknown) => error instanceof Error && error.message === "agent_busy",
    send: async () => {
      sends++;
      if (busy) throw new Error("agent_busy");
    },
  };
  await expect(requests.send(input)).rejects.toThrow("agent_busy");
  busy = false;
  await new MessageReceipts(directory).send(input);
  expect(sends).toBe(2);
});

async function snapshot(directory: string): Promise<Record<string, string>> {
  const entries = await readdir(directory);
  return Object.fromEntries(
    await Promise.all(
      entries.map(
        async (entry) => [entry, await readFile(path.join(directory, entry), "utf8")] as const,
      ),
    ),
  );
}

test("lookup reports completed, pending, and absent without changing receipts", async () => {
  const { requests, directory } = await fixture();
  const completed = {
    agentId: "agent",
    messageId: "completed",
    request: {},
    send: async () => undefined,
  };
  await requests.send(completed);
  const ambiguous = {
    agentId: "agent",
    messageId: "pending",
    request: {},
    send: async () => {
      throw new Error("connection lost");
    },
  };
  await expect(requests.send(ambiguous)).rejects.toThrow("connection lost");

  const before = await snapshot(directory);
  expect(await requests.lookup("agent", "completed")).toBe("accepted");
  expect(await requests.lookup("agent", "pending")).toBe("pending");
  expect(await requests.lookup("agent", "missing")).toBe("absent");
  expect(await snapshot(directory)).toEqual(before);

  // Lookup must not clear the ambiguity or make the identity retryable.
  await expect(new MessageReceipts(directory).send(ambiguous)).rejects.toThrow(
    "agent_request_outcome_unknown",
  );
});

test("lookup isolates the same message ID across agents", async () => {
  const { requests } = await fixture();
  let sends = 0;
  const send = (agentId: string) =>
    requests.send({
      agentId,
      messageId: "shared",
      request: {},
      send: async () => {
        sends++;
      },
    });
  await send("agent-a");
  expect(await requests.lookup("agent-a", "shared")).toBe("accepted");
  expect(await requests.lookup("agent-b", "shared")).toBe("absent");
  expect(sends).toBe(1);

  await send("agent-b");
  expect(await requests.lookup("agent-a", "shared")).toBe("accepted");
  expect(await requests.lookup("agent-b", "shared")).toBe("accepted");
  expect(sends).toBe(2);
});

test("lookup reports an in-flight send as pending instead of absent", async () => {
  const { requests } = await fixture();
  let release!: () => void;
  const prepared = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const preparing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const sending = requests.send({
    agentId: "agent",
    messageId: "message",
    request: {},
    prepare: async () => {
      started();
      await prepared;
    },
    send: async () => undefined,
  });
  await preparing;
  expect(await requests.lookup("agent", "message")).toBe("pending");
  release();
  await sending;
  expect(await requests.lookup("agent", "message")).toBe("accepted");
});

test("lookup does not create the receipt directory", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-requests-"));
  directories.push(directory);
  const missing = path.join(directory, "missing");
  const requests = new MessageReceipts(missing);

  expect(await requests.lookup("agent", "message")).toBe("absent");
  await expect(stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
});

test("lookup rejects a receipt recorded for another agent identity", async () => {
  const { requests, directory } = await fixture();
  const send = (agentId: string) =>
    requests.send({ agentId, messageId: "shared", request: {}, send: async () => undefined });
  await send("agent-a");
  await send("agent-b");
  const entries = await readdir(directory);
  const receipts = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry);
      return { file, receipt: JSON.parse(await readFile(file, "utf8")) as { agentId: string } };
    }),
  );
  const fromA = receipts.find((entry) => entry.receipt.agentId === "agent-a");
  const fromB = receipts.find((entry) => entry.receipt.agentId === "agent-b");
  if (!fromA || !fromB) throw new Error("expected one receipt per agent");
  await writeFile(fromB.file, await readFile(fromA.file, "utf8"));

  await expect(requests.lookup("agent-b", "shared")).rejects.toThrow(
    "agent_request_receipt_identity_mismatch",
  );
});

test("lookup rejects a corrupted receipt instead of reporting absent", async () => {
  const { requests, directory } = await fixture();
  await requests.send({
    agentId: "agent",
    messageId: "message",
    request: {},
    send: async () => undefined,
  });
  const [entry] = await readdir(directory);
  await writeFile(path.join(directory, entry), "{not json", "utf8");

  await expect(requests.lookup("agent", "message")).rejects.toThrow();
});

test("a send failure that is not proven no-effect stays ambiguous", async () => {
  const { requests, directory } = await fixture();
  let sends = 0;
  const input = {
    agentId: "agent",
    messageId: "message",
    request: {},
    isProvenNoEffect: (error: unknown) => error instanceof Error && error.message === "agent_busy",
    send: async () => {
      sends++;
      throw new Error("provider connection lost");
    },
  };
  await expect(requests.send(input)).rejects.toThrow("provider connection lost");
  await expect(new MessageReceipts(directory).send(input)).rejects.toThrow(
    "agent_request_outcome_unknown",
  );
  expect(sends).toBe(1);
});
