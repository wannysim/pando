#!/usr/bin/env node
// Local package smoke for the published `pandoctl` distribution.
//
// Deterministic checks (no real global install, no network publish):
//   1. build the bundle (esbuild) + copy schema.sql
//   2. `npm pack --dry-run --json` to list exactly what would publish
//   3. assert the compiled bin (dist/pandoctl.mjs) and dist/schema.sql are packed
//   4. assert the bin carries a shebang and a real `require` shim
//   5. run the built bin's `help` and a local-DB `show` to prove it loads
//      (better-sqlite3 native module) without booting a server
//
// Structured JSON evidence is written under /tmp; no secrets are emitted.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(repoRoot, "packages", "pandoctl");
const binRelPath = "dist/pandoctl.mjs";
const schemaRelPath = "dist/schema.sql";

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
}

// 1. Build
const build = await run("node", ["build.mjs"], { cwd: packageDir });
record("build", build.code === 0, build.code === 0 ? "ok" : build.stderr.slice(-400));

// 2. npm pack --dry-run --json
const pack = await run("npm", ["pack", "--dry-run", "--json"], { cwd: packageDir });
let packed = [];
let packName;
let packVersion;
try {
  const parsed = JSON.parse(pack.stdout);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  packed = (entry?.files ?? []).map((file) => file.path);
  packName = entry?.name;
  packVersion = entry?.version;
} catch (error) {
  record("npm-pack-json", false, `parse failed: ${String(error)} :: ${pack.stderr.slice(-300)}`);
}

if (packed.length > 0) {
  record("npm-pack-json", true, `${packed.length} files`);
  record("packs-compiled-bin", packed.includes(binRelPath), packed.join(", "));
  record("packs-schema", packed.includes(schemaRelPath), schemaRelPath);
  record("packs-no-source-tree", !packed.some((p) => p.startsWith("src/")), "no src/ in tarball");
  record(
    "name-and-version",
    packName === "pandoctl" && packVersion !== "0.0.1",
    `${packName}@${packVersion}`,
  );
}

// 3. bin shebang + require shim
let binText = "";
try {
  binText = await readFile(join(packageDir, binRelPath), "utf8");
} catch {
  binText = "";
}
record("bin-shebang", binText.startsWith("#!/usr/bin/env node"), binText.slice(0, 32));
record("bin-require-shim", binText.includes("createRequire"), "createRequire present");

// 4. run built bin: help (no server, no DB)
const help = await run("node", [join(packageDir, binRelPath), "help"]);
record(
  "bin-help",
  help.code === 0 &&
    help.stdout.includes("pandoctl start") &&
    help.stdout.includes("pandoctl submit"),
  `code=${help.code}`,
);

// 5. run built bin: local-DB show (loads native better-sqlite3, must not bind a port)
const workDir = await mkdtemp(join(tmpdir(), "pandoctl-pack-smoke-"));
const dbPath = join(workDir, "pando.sqlite");
const show = await run("node", [join(packageDir, binRelPath), "show", "nope"], {
  env: { ...process.env, PANDO_DB: dbPath, PANDO_API_URL: "" },
});
const showOutput = `${show.stdout}${show.stderr}`;
record(
  "bin-native-sqlite-load",
  show.code === 1 && showOutput.includes("job not found") && !showOutput.includes("EADDRINUSE"),
  `code=${show.code}`,
);

const ok = checks.every((check) => check.ok);
const evidenceDir = process.env.PANDOCTL_PACK_EVIDENCE_DIR ?? join(tmpdir(), "pandoctl-pack-smoke");
await mkdir(evidenceDir, { recursive: true });
const evidencePath = join(evidenceDir, "pandoctl-pack-smoke.json");
await writeFile(
  evidencePath,
  `${JSON.stringify(
    {
      mode: "pandoctl-pack-smoke",
      ok,
      package: { name: packName, version: packVersion },
      packedFiles: packed,
      checks,
    },
    null,
    2,
  )}\n`,
);
await rm(workDir, { recursive: true, force: true });

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name} :: ${check.detail}`);
}
console.log(`evidence=${evidencePath} ok=${ok}`);
process.exit(ok ? 0 : 1);
