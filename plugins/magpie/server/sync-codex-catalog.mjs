import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { withPersonalTiers, personalUltraModels } from "./codex-catalog.ts";
import { localRequest } from "./magpie.ts";

const home = homedir();
const source = join(home, ".codex/paseo-models-1m.json");
const target = join(home, ".config/magpie/paseo-codex-models.json");
const [raw, state, native] = await Promise.all([
  readFile(source, "utf8"),
  localRequest("/api/state"),
  localRequest("/v1/codex/models", undefined, true),
]);
const content =
  JSON.stringify(withPersonalTiers(JSON.parse(raw), personalUltraModels(state), native), null, 2) +
  "\n";
let previous;
try {
  previous = await readFile(target, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (previous !== content) {
  const temporary = target + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
