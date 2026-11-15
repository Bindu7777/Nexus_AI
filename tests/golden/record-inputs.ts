// One-time recorder for golden-snapshot inputs.
//
// Runs the real demo catalog once, captures the raw samples and telemetry
// identifiers the frozen rules consume, and writes them to tests/golden/inputs.
// It refuses to overwrite existing inputs. The golden test then replays these
// recorded inputs through the unchanged engine, so timing never matters.
//
// Usage: npx tsx tests/golden/record-inputs.ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { catalogJson } from "../../src/lib/catalog-client.ts";
import { runLoad } from "../../src/lib/load.ts";
import { scenario } from "../../src/lib/scenario.ts";

const outDir = path.join(process.cwd(), "tests/golden/inputs");

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

type Telemetry = {
  logs: { id: string; level: string; fields: Record<string, unknown> }[];
  traces: { traceId: string }[];
};

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of ["lock.json", "outage.json"]) {
    if (fs.existsSync(path.join(outDir, name))) {
      throw new Error(`${name} already exists. Recorded inputs are never overwritten.`);
    }
  }
  const port = await freePort();
  const child = spawn(process.execPath, ["services/catalog/server.mjs"], {
    env: { ...process.env, CATALOG_PORT: String(port), CATALOG_HOST: "127.0.0.1" },
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 200; i += 1) {
      try {
        await catalogJson(url, "/health");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 40));
      }
    }
    const mode = (m: string) => catalogJson(url, "/admin/mode", { method: "POST", body: JSON.stringify({ mode: m }) });

    await catalogJson(url, "/admin/reset", { method: "POST" });
    await mode("baseline");
    const baseline = await runLoad({ catalogUrl: url, phase: "baseline", profile: scenario.load });
    await mode("incident");
    const incident = await runLoad({ catalogUrl: url, phase: "incident", profile: scenario.load });
    const lockTelemetry = (await catalogJson(url, "/admin/telemetry")) as unknown as Telemetry;
    await mode("remediated");
    const validation = await runLoad({ catalogUrl: url, phase: "validation", profile: scenario.load });

    fs.writeFileSync(
      path.join(outDir, "lock.json"),
      `${JSON.stringify(
        {
          recordedAt: new Date().toISOString(),
          note: "Raw samples from one live run of services/catalog/server.mjs. Replayed by tests/golden.test.ts.",
          baseline,
          incident,
          validation,
          telemetry: {
            traceIds: lockTelemetry.traces.map((t) => t.traceId),
            logs: lockTelemetry.logs.map((l) => ({ id: l.id, level: l.level, mode: l.fields.mode, lockWaitMs: l.fields.lockWaitMs })),
          },
        },
        null,
        2,
      )}\n`,
    );

    await catalogJson(url, "/admin/reset", { method: "POST" });
    await mode("unavailable");
    const outage = await runLoad({ catalogUrl: url, phase: "outage", profile: scenario.outageLoad });
    const outageTelemetry = (await catalogJson(url, "/admin/telemetry")) as unknown as Telemetry;
    fs.writeFileSync(
      path.join(outDir, "outage.json"),
      `${JSON.stringify(
        {
          recordedAt: new Date().toISOString(),
          note: "Raw samples from one live outage run of services/catalog/server.mjs.",
          outage,
          telemetry: { logs: outageTelemetry.logs.map((l) => ({ id: l.id, level: l.level })) },
        },
        null,
        2,
      )}\n`,
    );
    console.log(`Recorded inputs in ${outDir}`);
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
