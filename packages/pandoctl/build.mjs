#!/usr/bin/env node
// Bundle the unified pandoctl CLI into a self-contained ESM file with a shebang.
//
// better-sqlite3 is a native module: it stays external so npm resolves its
// prebuilt binary at install time. Everything else (hono, yaml, the pando
// source tree) is inlined so the published package needs no source checkout.
//
// src/db/index.ts reads schema.sql relative to its own import.meta.url. After
// bundling, import.meta.url is the output bundle, so we copy schema.sql next to
// dist/pandoctl.mjs to keep that runtime lookup working.
import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const distDir = join(here, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [join(repoRoot, "src", "cli", "pandoctl.ts")],
  outfile: join(distDir, "pandoctl.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Native module — keep external, declared as a package dependency.
  external: ["better-sqlite3"],
  // Shebang first, then a real `require` so bundled CJS deps (which esbuild
  // rewrites to __require) resolve against Node instead of throwing.
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __pandoctlCreateRequire } from "node:module";',
      "const require = __pandoctlCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "info",
});

await copyFile(join(repoRoot, "src", "db", "schema.sql"), join(distDir, "schema.sql"));

console.log("built packages/pandoctl/dist/pandoctl.mjs (+ schema.sql)");
