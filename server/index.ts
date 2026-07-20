import { networkInterfaces } from "node:os";

import { createLanServer } from "./lan-server.ts";

function privateIpv4Addresses() {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.add(entry.address);
    }
  }
  return [...addresses];
}

const port = Number.parseInt(process.env.LAN_SERVER_PORT ?? "8787", 10);
const server = createLanServer({ host: "0.0.0.0", port: Number.isFinite(port) ? port : 8787 });

try {
  const address = await server.listen();
  console.log(`POKER DUEL LAN server: ${address.httpUrl}`);
  for (const ip of privateIpv4Addresses()) console.log(`LAN API: http://${ip}:${address.port}`);
  console.log("Keep this terminal open while LAN players are connected.");
} catch (error) {
  console.error("Unable to start the POKER DUEL LAN server.", error);
  process.exitCode = 1;
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await server.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
