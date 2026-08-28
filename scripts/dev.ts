import { spawn } from "node:child_process";

const server = spawn("bun", ["--watch", "src/server/index.ts"], { stdio: "inherit" });
const vite = spawn("bunx", ["vite", "--port", "5173"], { stdio: "inherit" });

const stop = () => {
  server.kill();
  vite.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
