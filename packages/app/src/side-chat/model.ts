export type SideChatExchangeStatus = "pending" | "answered" | "failed";

export interface SideChatExchange {
  id: string;
  question: string;
  status: SideChatExchangeStatus;
  response: string | null;
  synthetic: boolean;
  error: string | null;
}

export interface SideChatAnswerPayload {
  response: string | null;
  synthetic?: boolean;
  error?: string | null;
}

const SIDE_CHAT_KEY_SEPARATOR = "\0";

export function sideChatKey(serverId: string, agentId: string): string {
  return `${serverId}${SIDE_CHAT_KEY_SEPARATOR}${agentId}`;
}

export function beginSideChatExchange(
  exchanges: readonly SideChatExchange[],
  input: { id: string; question: string },
): SideChatExchange[] {
  return [
    ...exchanges,
    {
      id: input.id,
      question: input.question,
      status: "pending",
      response: null,
      synthetic: false,
      error: null,
    },
  ];
}

export function resolveSideChatExchange(
  exchanges: readonly SideChatExchange[],
  id: string,
  payload: SideChatAnswerPayload,
): SideChatExchange[] {
  return exchanges.map((exchange) => {
    if (exchange.id !== id || exchange.status !== "pending") {
      return exchange;
    }
    if (payload.error) {
      return { ...exchange, status: "failed", error: payload.error };
    }
    if (payload.response === null) {
      return { ...exchange, status: "failed", error: null };
    }
    return {
      ...exchange,
      status: "answered",
      response: payload.response,
      synthetic: payload.synthetic === true,
    };
  });
}

export function failSideChatExchange(
  exchanges: readonly SideChatExchange[],
  id: string,
  error: string,
): SideChatExchange[] {
  return resolveSideChatExchange(exchanges, id, { response: null, error });
}

export function hasPendingSideChatExchange(exchanges: readonly SideChatExchange[]): boolean {
  return exchanges.some((exchange) => exchange.status === "pending");
}
