import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!existsSync(fileURLToPath(new URL("../dist/index.html", import.meta.url)))) {
  console.log("opencode-knobs: building frontend…");
  const res = spawnSync("bun", ["run", "build"], { stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const res = spawnSync("bun", ["src/server/index.ts", ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: fileURLToPath(new URL("..", import.meta.url)),
});
process.exit(res.status ?? 1);
