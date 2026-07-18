// Build script: compiles each TypeScript form script to a Dataverse web resource
// Output files have no extension (Dataverse web resource convention)

import * as esbuild from "esbuild";
import { readdirSync, renameSync, existsSync } from "fs";
import { join } from "path";

const isWatch = process.argv.includes("--watch");
const srcDir = "src";
const outDir = "../solution/VelopsCustomers/WebResources";

// Each .ts file in src/ becomes one web resource (no extension = Dataverse convention)
const sourceFiles = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
const entryPoints = sourceFiles.map((f) => ({
  in: join(srcDir, f),
  out: f.replace(".ts", ""),
}));

function renameOutputs() {
  // esbuild outputs <name>.js — Dataverse web resources have no extension
  for (const { out } of entryPoints) {
    const withExt = join(outDir, out + ".js");
    const withoutExt = join(outDir, out);
    if (existsSync(withExt)) {
      renameSync(withExt, withoutExt);
      console.log(`  renamed: ${out}.js → ${out}`);
    }
  }
}

/** @type {esbuild.BuildOptions} */
const config = {
  entryPoints,
  bundle: true,
  format: "iife",
  target: "es2018",
  outdir: outDir,
  logLevel: "info",
};

if (isWatch) {
  const ctx = await esbuild.context({
    ...config,
    plugins: [{ name: "rename", setup(build) { build.onEnd(renameOutputs); } }],
  });
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(config);
  renameOutputs();
}
