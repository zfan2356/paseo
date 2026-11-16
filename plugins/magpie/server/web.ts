import { managementConnection, type ConnectionOptions } from "./connection.js";

export async function webUiLink(options: ConnectionOptions = {}): Promise<{ url: string }> {
  const { pageUrl, key } = await managementConnection(options);
  pageUrl.searchParams.set("k", key);
  return { url: pageUrl.href };
}
