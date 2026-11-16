import {
  AgentSnapshotPayloadSchema,
  type AgentSnapshotPayload,
  type CreationSnapshot,
  type SessionOutboundMessage,
} from "@getpaseo/protocol/messages";

interface Options {
  external: boolean;
  canStop: boolean;
  nativeSummary(agentId: string): { count: number } | undefined;
}

type AgentProjection = <T extends AgentSnapshotPayload | null | undefined>(value: T) => T;

// COMPAT(externalBackgroundWork): added after v0.15.3, remove after 2027-05-14.
export function projectBackgroundWork(
  message: SessionOutboundMessage,
  options: Options,
): SessionOutboundMessage {
  if (
    message.type === "agent.background_work.list.response" ||
    message.type === "agent.background_work.update"
  ) {
    const visible = message.payload.items.filter((item) => options.external || !item.external);
    const items = options.canStop
      ? visible
      : visible.map(({ canStop: _canStop, stopToken: _stopToken, ...item }) => item);
    if (message.type === "agent.background_work.list.response")
      return { ...message, payload: { ...message.payload, items } };
    return { ...message, payload: { ...message.payload, items } };
  }
  if (options.external) return message;
  const agent: AgentProjection = (value) => {
    if (!value) return value;
    return { ...value, backgroundWork: options.nativeSummary(value.id) };
  };
  return projectLegacySnapshots(message, agent);
}

function projectLegacySnapshots(
  message: SessionOutboundMessage,
  agent: AgentProjection,
): SessionOutboundMessage {
  switch (message.type) {
    case "agent_update":
      return message.payload.kind === "upsert"
        ? { ...message, payload: { ...message.payload, agent: agent(message.payload.agent) } }
        : message;
    case "agent_status":
      return { ...message, payload: { ...message.payload, info: agent(message.payload.info) } };
    case "clear_agent_attention_response":
      return {
        ...message,
        payload: { ...message.payload, agents: message.payload.agents.map(agent) },
      };
    case "fetch_agents_response":
    case "fetch_agent_history_response":
      return {
        ...message,
        payload: {
          ...message.payload,
          entries: message.payload.entries.map((entry) => ({
            ...entry,
            agent: agent(entry.agent),
          })),
        },
      };
    case "fetch_agent_response":
      return { ...message, payload: { ...message.payload, agent: agent(message.payload.agent) } };
    case "fetch_agent_timeline_response":
      return { ...message, payload: { ...message.payload, agent: agent(message.payload.agent) } };
    case "cancel_agent_response":
      return { ...message, payload: { ...message.payload, agent: agent(message.payload.agent) } };
    case "hub.execution.agent.update":
      return { ...message, payload: { ...message.payload, agent: agent(message.payload.agent) } };
    case "hub.execution.agent.create.response":
      return { ...message, payload: { ...message.payload, agent: agent(message.payload.agent) } };
    case "wait_for_finish_response":
      return { ...message, payload: { ...message.payload, final: agent(message.payload.final) } };
    default:
      return projectLegacyCreation(message, agent);
  }
}

function projectLegacyCreation(
  message: SessionOutboundMessage,
  agent: AgentProjection,
): SessionOutboundMessage {
  const creation = <T extends CreationSnapshot | null | undefined>(value: T): T => {
    if (!value) return value;
    return { ...value, agent: agent(value.agent) };
  };
  switch (message.type) {
    case "status":
      if (message.payload.status === "agent_created" || message.payload.status === "agent_resumed")
        return {
          ...message,
          payload: {
            ...message.payload,
            agent: agent(AgentSnapshotPayloadSchema.parse(message.payload.agent)),
          },
        };
      return message;
    case "agent.create.response":
      return {
        ...message,
        payload: {
          ...message.payload,
          agent: agent(message.payload.agent),
          creation: creation(message.payload.creation),
        },
      };
    case "agent.create.update":
      return {
        ...message,
        payload: { ...creation(message.payload), subscriptionId: message.payload.subscriptionId },
      };
    case "workspace.create.update":
      return {
        ...message,
        payload: { ...creation(message.payload), subscriptionId: message.payload.subscriptionId },
      };
    case "workspace.create.response":
      return {
        ...message,
        payload: {
          ...message.payload,
          agent: agent(message.payload.agent),
          creation: creation(message.payload.creation),
        },
      };
    case "creation.subscribe.response":
      return {
        ...message,
        payload: { ...message.payload, snapshot: creation(message.payload.snapshot) },
      };
    default:
      return message;
  }
}
