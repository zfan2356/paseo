export function onProvider(
  body: Record<string, unknown>,
  ctx: {
    protocol: string;
    provider?: { id: string; model: string };
    options?: { ultrafastModels?: string[] };
  },
): Record<string, unknown> | undefined;
