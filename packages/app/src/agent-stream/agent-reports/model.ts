import type { AgentMessage } from "@getpaseo/protocol/agent-message";
import type { StreamItem, UserMessageItem } from "@/types/stream";
import type { ReadingRowReplacements } from "../reading-anchor";

export interface AgentReportEntry {
  id: string;
  message: AgentMessage;
}

export interface AgentReport {
  entries: readonly AgentReportEntry[];
}

interface ReportRows {
  rows: StreamItem[];
  hosts: ReadonlyMap<string, string>;
}

interface ReportProjection {
  tail: StreamItem[];
  head: StreamItem[];
  hosts: ReadingRowReplacements;
}

function agentMessage(item: StreamItem): AgentMessage | undefined {
  return item.kind === "tool_call" && item.payload.source === "agent"
    ? item.payload.data.agentMessage
    : undefined;
}

function canAppend(
  previous: StreamItem | undefined,
  item: StreamItem,
  message: AgentMessage,
): previous is UserMessageItem & { agentReport: AgentReport } {
  if (previous?.kind !== "user_message" || !previous.agentReport) return false;
  const sender = previous.agentReport.entries[0]!.message.sender;
  return (
    previous.turnId !== undefined &&
    previous.turnId === item.turnId &&
    sender.id === message.sender.id &&
    sender.serverId === message.sender.serverId &&
    (message.event === "message" || message.event === "finished")
  );
}

function appendEntries(
  host: UserMessageItem & { agentReport: AgentReport },
  entries: readonly AgentReportEntry[],
): UserMessageItem {
  return {
    ...host,
    text: [host.text, ...entries.map((entry) => entry.message.text)].join("\n\n"),
    agentReport: { entries: [...host.agentReport.entries, ...entries] },
  };
}

function projectRows(items: StreamItem[]): ReportRows {
  const rows: StreamItem[] = [];
  const hosts = new Map<string, string>();
  for (const item of items) {
    const message = agentMessage(item);
    if (!message) {
      rows.push(item);
      continue;
    }
    const previous = rows.at(-1);
    if (canAppend(previous, item, message)) {
      rows[rows.length - 1] = appendEntries(previous, [{ id: item.id, message }]);
      hosts.set(item.id, previous.id);
    } else if (message.event === "message") {
      rows.push({
        kind: "user_message",
        id: item.id,
        turnId: item.turnId,
        timelineCursor: item.timelineCursor,
        timestamp: item.timestamp,
        text: message.text,
        sender: message.sender,
        agentReport: { entries: [{ id: item.id, message }] },
      });
    } else {
      rows.push(item);
    }
  }
  return {
    rows:
      rows.length === items.length && rows.every((row, index) => row === items[index])
        ? items
        : rows,
    hosts,
  };
}

/** Group presentation only; canonical rows and provider messages stay intact. */
export function createAgentReportProjection() {
  const cache = new WeakMap<StreamItem[], ReportRows>();
  let previousTail: StreamItem[] | undefined;
  let previousHead: StreamItem[] | undefined;
  let previous: ReportProjection | undefined;
  function prepare(items: StreamItem[]): ReportRows {
    let prepared = cache.get(items);
    if (!prepared) {
      prepared = projectRows(items);
      cache.set(items, prepared);
    }
    return prepared;
  }
  return (tail: StreamItem[], head: StreamItem[]): ReportProjection => {
    if (previous && previousTail === tail && previousHead === head) return previous;
    const history = prepare(tail);
    const live = prepare(head);
    const last = history.rows.at(-1);
    const first = live.rows[0];
    const entries = first?.kind === "user_message" ? first.agentReport?.entries : undefined;
    const message = entries?.[0]?.message ?? (first && agentMessage(first));
    const joinsHistory = first && message && canAppend(last, first, message);
    const joinedEntries = entries ?? (first && message ? [{ id: first.id, message }] : []);
    previous = {
      tail: joinsHistory
        ? [...history.rows.slice(0, -1), appendEntries(last, joinedEntries)]
        : history.rows,
      head: joinsHistory ? live.rows.slice(1) : live.rows,
      hosts: {
        get(id) {
          const host = live.hosts.get(id) ?? id;
          if (joinsHistory && host === first.id) return last.id;
          return history.hosts.get(host) ?? live.hosts.get(id);
        },
      },
    };
    previousTail = tail;
    previousHead = head;
    return previous;
  };
}
