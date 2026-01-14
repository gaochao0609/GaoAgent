const { spawn } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const backendPort = process.env.BACKEND_PORT || "8000";
const frontendPort = process.env.FRONTEND_PORT || "3000";
const pythonBin =
  process.env.HELLOAGENT_PYTHON || process.env.PYTHON || "python";

const backendArgs = [
  "-m",
  "uvicorn",
  "backend.main:app",
  "--host",
  "0.0.0.0",
  "--port",
  backendPort,
];

const npmBin = "npm";
const frontendArgs = [
  "--prefix",
  path.join(repoRoot, "web"),
  "run",
  "dev",
  "--",
  "--hostname",
  "0.0.0.0",
  "--port",
  frontendPort,
];

const useShell = process.platform === "win32";

const backend = spawn(pythonBin, backendArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  shell: useShell,
});

const frontend = spawn(npmBin, frontendArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  shell: useShell,
});

const shutdown = (signal) => {
  if (backend.exitCode === null) {
    backend.kill(signal);
  }
  if (frontend.exitCode === null) {
    frontend.kill(signal);
  }
};

backend.on("exit", (code) => {
  if (code !== 0 && frontend.exitCode === null) {
    frontend.kill("SIGINT");
  }
});

frontend.on("exit", (code) => {
  if (code !== 0 && backend.exitCode === null) {
    backend.kill("SIGINT");
  }
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
