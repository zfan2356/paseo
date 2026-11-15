#!/usr/bin/env node
// Fork material layer bookkeeping. See docs/fork/SYNC.md.
//
//   node scripts/fork/material-layer.mjs hooks [<rev>] [--upstream <ref>]
//       Hook lines the material layer keeps in files that also exist upstream.
//   node scripts/fork/material-layer.mjs stat <rev> [--upstream <ref>]
//       Material hunks in upstream files between merge-base(rev, upstream) and rev.
//   node scripts/fork/material-layer.mjs trial-merge <rev> [--upstream <ref>]
//       Merge upstream into rev in memory (git merge-tree) and count conflicts.
import { execFileSync } from "node:child_process";

const MARKER =
  /MATERIAL_SLOTS|@\/fork\/materials|fork\/materials\/|data-material|\bmaterial: "|materialTab|sidebarMaterialColor|materialSheetBackground|<Materials\b|\bMaterials\b.*from|paseo-(chrome|composer)-clearance|paseo-sidebar-material|publish(Chrome|Composer)Clearance|materialWindowOptions|setupWindowMaterial|updateMaterialBackground|\bMATERIAL\b|E2E_GPU_COMPOSITING|qa-evidence\/materials/;
// Pre-layer revisions threaded the active tab into the workspace chrome under this name.
const LEGACY_MARKER = /activeTab=\{activeTabDescriptor\}/;
const isMaterialLine = (line) => MARKER.test(line) || LEGACY_MARKER.test(line);
const FORK_OWNED =
  /^(packages\/app\/src\/fork\/|packages\/desktop\/src\/fork\/|docs\/fork\/|scripts\/fork\/)/;

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 30, ...options });
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  let upstream = "upstream/main";
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--upstream") upstream = rest[++index];
    else positional.push(rest[index]);
  }
  return { command, positional, upstream };
}

// Files present in both revisions are upstream-owned; everything else is fork-owned.
function upstreamFiles(rev, upstream) {
  const base = git(["merge-base", rev, upstream]).trim();
  const changed = git(["diff", "--name-only", "--diff-filter=M", base, rev])
    .split("\n")
    .filter(Boolean);
  return { base, files: changed.filter((file) => !FORK_OWNED.test(file)) };
}

function hunks(base, rev, file) {
  const diff = git(["diff", "-U0", base, rev, "--", file]);
  const result = [];
  let current = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      current = { header: line, lines: [] };
      result.push(current);
    } else if (current && /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line)) {
      current.lines.push(line);
    }
  }
  return result;
}

function stat(rev, upstream) {
  const { base, files } = upstreamFiles(rev, upstream);
  const rows = [];
  for (const file of files) {
    const material = hunks(base, rev, file).filter((hunk) => hunk.lines.some(isMaterialLine));
    if (material.length === 0) continue;
    const lines = material.flatMap((hunk) => hunk.lines);
    rows.push({
      file,
      hunks: material.length,
      added: lines.filter((line) => line.startsWith("+")).length,
      removed: lines.filter((line) => line.startsWith("-")).length,
    });
  }
  return { base, rows };
}

function hooks(rev, upstream) {
  const upstreamOwned = new Set(git(["ls-tree", "-r", "--name-only", upstream]).split("\n"));
  // Coarse pass in git, exact MARKER match in JS.
  let candidates = "";
  try {
    candidates = git(["grep", "-l", "-i", "-E", "material|paseo-|E2E_GPU", rev]);
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of candidates.split("\n").filter(Boolean)) {
    const file = entry.slice(rev.length + 1);
    if (FORK_OWNED.test(file) || !upstreamOwned.has(file)) continue;
    git(["show", `${rev}:${file}`])
      .split("\n")
      .forEach((line, index) => {
        if (isMaterialLine(line)) rows.push({ file, line: index + 1, text: line.trim() });
      });
  }
  return rows;
}

function trialMerge(rev, upstream) {
  let output;
  try {
    output = git(["merge-tree", "--write-tree", "--name-only", rev, upstream]);
  } catch (error) {
    output = error.stdout;
  }
  const [tree, ...rest] = output.split("\n");
  const blank = rest.indexOf("");
  const conflicted = rest.slice(0, blank === -1 ? rest.length : blank).filter(Boolean);
  const rows = conflicted.map((file) => {
    let text = "";
    try {
      text = git(["show", `${tree}:${file}`]);
    } catch {
      return { file, blocks: 0, material: 0, note: "add/delete or binary" };
    }
    const blocks = text.split(/^<<<<<<< .*$/m).slice(1);
    const material = blocks.filter((block) =>
      block
        .split(/^>>>>>>> .*$/m)[0]
        .split("\n")
        .some(isMaterialLine),
    );
    return { file, blocks: blocks.length, material: material.length };
  });
  return { tree, rows };
}

const { command, positional, upstream } = parseArgs(process.argv.slice(2));
if (command === "hooks") {
  const rows = hooks(positional[0] ?? "HEAD", upstream);
  const files = new Set(rows.map((row) => row.file));
  for (const row of rows) console.log(`${row.file}:${row.line}\t${row.text}`);
  console.log(`\n${files.size} upstream files, ${rows.length} hook lines`);
} else if (command === "stat") {
  const { base, rows } = stat(positional[0] ?? "HEAD", upstream);
  for (const row of rows)
    console.log(`${row.file}\t${row.hunks} hunks\t+${row.added} -${row.removed}`);
  const total = rows.reduce((sum, row) => sum + row.added + row.removed, 0);
  console.log(
    `\nmerge-base ${base.slice(0, 9)}: ${rows.length} upstream files, ${total} changed lines`,
  );
} else if (command === "trial-merge") {
  const { rows } = trialMerge(positional[0] ?? "HEAD", upstream);
  for (const row of rows) {
    console.log(
      `${row.file}\t${row.blocks} blocks\t${row.material} material${row.note ? `\t${row.note}` : ""}`,
    );
  }
  const materialRows = rows.filter((row) => row.material > 0);
  const materialBlocks = rows.reduce((sum, row) => sum + row.material, 0);
  console.log(
    `\n${rows.length} conflicted files; material: ${materialRows.length} files, ${materialBlocks} blocks`,
  );
} else {
  console.error("usage: material-layer.mjs hooks|stat|trial-merge [<rev>] [--upstream <ref>]");
  process.exit(2);
}
