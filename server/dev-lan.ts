import { spawn, type ChildProcess } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children: ChildProcess[] = [];

function run(script: string) {
  const child = spawn(npmCommand, ["run", script], {
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);
  child.once("exit", (code, signal) => {
    if (!stopping && (code !== 0 || signal)) {
      console.error(`${script} stopped unexpectedly.`);
      void stop(code ?? 1);
    }
  });
}

let stopping = false;
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once("exit", () => resolve());
        }),
    ),
  );
  process.exit(exitCode);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

run("dev:lan:web");
run("server:dev");
