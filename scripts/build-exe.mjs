import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postject from "postject";

if (process.platform !== "win32") {
  throw new Error("Build the Windows executable on Windows using Node.js 22 or newer.");
}
if (Number(process.versions.node.split(".")[0]) < 22) {
  throw new Error("Building sql-mcp.exe requires Node.js 22 or newer.");
}

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const buildDirectory = join(projectRoot, "dist", "sea");
const releaseDirectory = join(projectRoot, "release");
const bundlePath = join(buildDirectory, "sql-mcp.cjs");
const blobPath = join(buildDirectory, "sql-mcp.blob");
const configPath = join(buildDirectory, "sea-config.json");
const executableName = process.argv[2] ?? "sql-mcp.exe";
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.exe$/.test(executableName)) {
  throw new Error("The output name must be a Windows .exe filename, for example sql-mcp-next.exe.");
}
const executablePath = join(releaseDirectory, executableName);

await mkdir(buildDirectory, { recursive: true });
await mkdir(releaseDirectory, { recursive: true });

// SEA on Node.js 22/24 accepts a single CommonJS entry point. Bundle both
// providers and their dependencies; only Node's built-in modules stay external.
const result = await build({
  absWorkingDir: projectRoot,
  entryPoints: ["src/index.ts"],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  metafile: true,
  legalComments: "eof",
  define: { "import.meta.url": "__sqlMcpModuleUrl" },
  banner: {
    js: 'const __sqlMcpModuleUrl = require("node:url").pathToFileURL(__filename).href;',
  },
});

// Neither pg's optional native driver nor debug's optional terminal colors are
// required. Both are already optional in normal npm installations.
const optionalPackages = new Set(["pg-native", "supports-color"]);
// Fail if future dependencies introduce other unbundled packages.
const externalPackages = new Set(
  Object.values(result.metafile.outputs).flatMap((output) =>
    output.imports
      .filter((entry) => entry.external && !isBuiltin(entry.path) && !optionalPackages.has(entry.path))
      .map((entry) => entry.path)
  )
);
if (externalPackages.size > 0) {
  throw new Error(`Dependencies left outside the executable: ${[...externalPackages].join(", ")}`);
}

await writeFile(configPath, JSON.stringify({
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
}, null, 2));

// Use the very same Node binary to prepare the blob and supply the runtime.
execFileSync(process.execPath, ["--experimental-sea-config", configPath], {
  cwd: projectRoot,
  stdio: "inherit",
  windowsHide: true,
});
await copyFile(process.execPath, executablePath);
await postject.inject(executablePath, "NODE_SEA_BLOB", await readFile(blobPath), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
});

const exampleEnvironment = await readFile(join(projectRoot, ".env.example"), "utf8");
await writeFile(
  join(releaseDirectory, ".env.example"),
  exampleEnvironment.replace(/^# PORT=3000\r?$/m, "PORT=3000")
);

const sizeMb = ((await stat(executablePath)).size / 1024 / 1024).toFixed(1);
process.stdout.write(
  `\nCreated release/${executableName} (${sizeMb} MB, Windows ${process.arch}, Node.js ${process.versions.node}).\n` +
  "Copy release/.env.example to release/.env and configure your database.\n" +
  `Run .\\release\\${executableName} (HTTP) or unset PORT for MCP stdio.\n`
);
