import type { StreamItem } from "@/types/stream";

export type IntermediateProcessItem = Extract<
  StreamItem,
  { kind: "assistant_message" | "thought" | "tool_call" | "todo_list" | "compaction" }
>;

export interface IntermediateProcessGroup {
  id: string;
  hostId: string;
  items: readonly IntermediateProcessItem[];
  isActive: boolean;
  hasError: boolean;
  stepCount: number;
}

export interface IntermediateProcessProjection {
  tail: StreamItem[];
  head: StreamItem[];
  groupsByHostId: ReadonlyMap<string, IntermediateProcessGroup>;
  historyGroupUpdatesByHostId: ReadonlySet<string>;
}

export function getIntermediateProcessDefaultExpanded(group: IntermediateProcessGroup): boolean {
  return group.isActive;
}

interface PositionedItem {
  item: StreamItem;
  segment: "tail" | "head";
}

interface GroupRange {
  start: number;
  end: number;
}

const EMPTY_GROUPS = new Map<string, IntermediateProcessGroup>();
const EMPTY_IDS = new Set<string>();
const projectedTailCache = new WeakMap<StreamItem[], Map<string, StreamItem[]>>();

function isIntermediateProcessItem(item: StreamItem): item is IntermediateProcessItem {
  return (
    item.kind === "assistant_message" ||
    item.kind === "thought" ||
    item.kind === "tool_call" ||
    item.kind === "todo_list" ||
    item.kind === "compaction"
  );
}

function isProcessStep(item: StreamItem): boolean {
  return item.kind === "thought" || item.kind === "tool_call" || item.kind === "todo_list";
}

function getToolCallStatus(item: Extract<StreamItem, { kind: "tool_call" }>): string {
  return item.payload.data.status;
}

function isRunningItem(item: IntermediateProcessItem): boolean {
  if (item.kind === "thought") {
    return item.status !== "ready";
  }
  if (item.kind === "tool_call") {
    const status = getToolCallStatus(item);
    return status === "running" || status === "executing";
  }
  if (item.kind === "compaction") {
    return item.status === "loading";
  }
  return false;
}

function isFailedItem(item: IntermediateProcessItem): boolean {
  return item.kind === "tool_call" && getToolCallStatus(item) === "failed";
}

function findGroupRanges(items: readonly PositionedItem[]): GroupRange[] {
  const ranges: GroupRange[] = [];
  let segmentStart = 0;

  const flushSegment = (segmentEnd: number) => {
    let lastProcessIndex = -1;
    for (let index = segmentStart; index < segmentEnd; index += 1) {
      const item = items[index]?.item;
      if (item && isProcessStep(item)) {
        lastProcessIndex = index;
      }
    }
    if (lastProcessIndex >= segmentStart) {
      ranges.push({ start: segmentStart, end: lastProcessIndex + 1 });
    }
  };

  for (let index = 0; index <= items.length; index += 1) {
    const item = items[index]?.item;
    if (item && isIntermediateProcessItem(item)) {
      continue;
    }
    flushSegment(index);
    segmentStart = index + 1;
  }

  return ranges;
}

function projectTail(input: { tail: StreamItem[]; hiddenIds: ReadonlySet<string> }): StreamItem[] {
  if (input.hiddenIds.size === 0) {
    return input.tail;
  }
  const cacheKey = [...input.hiddenIds].sort().join("\u0000");
  let cachedByKey = projectedTailCache.get(input.tail);
  if (!cachedByKey) {
    cachedByKey = new Map();
    projectedTailCache.set(input.tail, cachedByKey);
  }
  const cached = cachedByKey.get(cacheKey);
  if (cached) {
    return cached;
  }
  const projected = input.tail.filter((item) => !input.hiddenIds.has(item.id));
  cachedByKey.set(cacheKey, projected);
  return projected;
}

export function projectIntermediateProcess(input: {
  tail: StreamItem[];
  head: StreamItem[];
  isTurnActive: boolean;
}): IntermediateProcessProjection {
  const positioned: PositionedItem[] = [
    ...input.tail.map((item) => ({ item, segment: "tail" as const })),
    ...input.head.map((item) => ({ item, segment: "head" as const })),
  ];
  const ranges = findGroupRanges(positioned);
  if (ranges.length === 0) {
    return {
      tail: input.tail,
      head: input.head,
      groupsByHostId: EMPTY_GROUPS,
      historyGroupUpdatesByHostId: EMPTY_IDS,
    };
  }

  const groupsByHostId = new Map<string, IntermediateProcessGroup>();
  const hiddenTailIds = new Set<string>();
  const hiddenHeadIds = new Set<string>();
  const historyGroupUpdatesByHostId = new Set<string>();
  const lastUserIndex = positioned.findLastIndex(({ item }) => item.kind === "user_message");

  for (const range of ranges) {
    const entries = positioned.slice(range.start, range.end);
    const items = entries.map(({ item }) => item).filter(isIntermediateProcessItem);
    const host = entries[0];
    if (!host || !isIntermediateProcessItem(host.item) || items.length === 0) {
      continue;
    }

    const isCurrentTurn = range.start > lastUserIndex;
    const isActive =
      items.some(isRunningItem) ||
      (input.isTurnActive && isCurrentTurn && range.end > lastUserIndex);
    const group: IntermediateProcessGroup = {
      id: host.item.id,
      hostId: host.item.id,
      items,
      isActive,
      hasError: items.some(isFailedItem),
      stepCount: items.filter(isProcessStep).length,
    };
    groupsByHostId.set(group.hostId, group);

    for (const entry of entries.slice(1)) {
      if (entry.segment === "tail") {
        hiddenTailIds.add(entry.item.id);
      } else {
        hiddenHeadIds.add(entry.item.id);
      }
    }
    if (
      host.segment === "tail" &&
      (isCurrentTurn || entries.some((entry) => entry.segment === "head"))
    ) {
      historyGroupUpdatesByHostId.add(host.item.id);
    }
  }

  return {
    tail: projectTail({ tail: input.tail, hiddenIds: hiddenTailIds }),
    head:
      hiddenHeadIds.size > 0
        ? input.head.filter((item) => !hiddenHeadIds.has(item.id))
        : input.head,
    groupsByHostId,
    historyGroupUpdatesByHostId,
  };
}
