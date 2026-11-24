// Run on the Magpie host with Bun. One SSH session owns one login flow.
import { createInterface } from "node:readline";
import { z } from "zod";
import { MagpieBridge } from "./magpie.js";
import { dispatch, operationSchema } from "./operations.js";

const envelope = z.object({ id: z.number().int().positive(), operation: operationSchema });
const bridge = new MagpieBridge();
const input = createInterface({ input: process.stdin });
function parseRequest(line: string) {
  try {
    return envelope.safeParse(JSON.parse(line));
  } catch {
    return null;
  }
}
input.on("line", (line) => {
  if (line.length > 65536) {
    process.exitCode = 1;
    input.close();
    return;
  }
  const request = parseRequest(line);
  if (!request?.success) {
    process.exitCode = 1;
    input.close();
    return;
  }
  const { id, operation } = request.data;
  void dispatch(bridge, operation).then(
    (value) => process.stdout.write(JSON.stringify({ id, value }) + "\n"),
    () =>
      process.stdout.write(
        JSON.stringify({ id, error: "远程 Magpie 操作失败，请检查服务与账号状态。" }) + "\n",
      ),
  );
});
const close = () => {
  bridge.dispose();
  process.exitCode = 0;
  input.close();
};
input.on("close", () => bridge.dispose());
process.once("SIGTERM", close);
process.once("SIGINT", close);
process.once("SIGHUP", close);
