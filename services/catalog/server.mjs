import http from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import scenario from "../scenario.json" with { type: "json" };

const products = new Map(scenario.products.map((product) => [product.id, product]));

function roundMs(value) {
  return Math.round(value * 100) / 100;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class Mutex {
  constructor() {
    this.locked = false;
    this.waiters = [];
    this.maxQueueDepth = 0;
  }

  tryAcquire() {
    if (this.locked) return null;
    this.locked = true;
    return { waitMs: 0, queueDepthAtAcquire: 0 };
  }

  async acquire() {
    if (!this.locked) {
      this.locked = true;
      return { waitMs: 0, queueDepthAtAcquire: 0 };
    }
    const queuedBehind = this.waiters.length + 1;
    this.maxQueueDepth = Math.max(this.maxQueueDepth, queuedBehind);
    const start = performance.now();
    await new Promise((resolve) => {
      this.waiters.push(resolve);
    });
    return { waitMs: performance.now() - start, queueDepthAtAcquire: queuedBehind };
  }

  release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.locked = false;
  }
}

const state = {
  mode: "baseline",
  mutex: new Mutex(),
  logs: [],
  traces: [],
  requests: [],
  logSeq: 0,
  startedAt: Date.now(),
};

function resetState() {
  state.mode = "baseline";
  state.mutex = new Mutex();
  state.logs = [];
  state.traces = [];
  state.requests = [];
  state.logSeq = 0;
}

function pushCapped(list, item) {
  list.push(item);
  if (list.length > 1000) list.shift();
}

// nexus-source-start: readProduct
function modeSpec(mode) {
  if (mode === "incident") {
    return { workPlacement: "inside-lock", unavailable: false };
  }
  if (mode === "unavailable") {
    return { workPlacement: "none", unavailable: true };
  }
  // baseline and remediated share this placement. Remediated is the sandbox
  // stand-in for the proposal. It is not a separate production patch.
  return { workPlacement: "outside-lock", unavailable: false };
}

async function readProduct(productId) {
  const mode = state.mode;
  const spec = modeSpec(mode);
  const traceId = randomUUID();
  const logId = `log_${++state.logSeq}`;
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const product = products.get(productId);

  const finish = (fields) => {
    const serverDurationMs = roundMs(performance.now() - started);
    const level = fields.status >= 500 ? "error" : (fields.lockWaitMs ?? 0) >= 50 ? "warn" : "info";
    const log = {
      id: logId,
      at: startedAt,
      level,
      traceId,
      message: fields.message,
      fields: {
        productId,
        mode,
        status: fields.status,
        lockWaitMs: fields.lockWaitMs,
        lockHoldMs: fields.lockHoldMs,
        queueDepth: fields.queueDepth,
        workPlacement: spec.workPlacement,
        serverDurationMs,
      },
    };
    const trace = {
      traceId,
      logId,
      startedAt,
      durationMs: serverDurationMs,
      status: fields.status,
      productId,
      mode,
      workPlacement: spec.workPlacement,
      spans: fields.spans,
    };
    const request = {
      traceId,
      logId,
      productId,
      mode,
      status: fields.status,
      serverDurationMs,
      lockWaitMs: fields.lockWaitMs,
      lockHoldMs: fields.lockHoldMs,
      queueDepth: fields.queueDepth,
    };
    pushCapped(state.logs, log);
    pushCapped(state.traces, trace);
    pushCapped(state.requests, request);
    return {
      status: fields.status,
      body: fields.body,
      headers: {
        "x-trace-id": traceId,
        "x-log-id": logId,
        "x-catalog-mode": mode,
        "x-server-duration-ms": String(serverDurationMs),
        ...(fields.lockWaitMs == null ? {} : { "x-lock-wait-ms": String(fields.lockWaitMs) }),
        ...(fields.lockHoldMs == null ? {} : { "x-lock-hold-ms": String(fields.lockHoldMs) }),
        ...(fields.queueDepth == null ? {} : { "x-queue-depth": String(fields.queueDepth) }),
      },
    };
  };

  if (!product) {
    return finish({
      status: 404,
      message: "unknown_product",
      lockWaitMs: null,
      lockHoldMs: null,
      queueDepth: null,
      spans: [],
      body: { error: "unknown_product", traceId, productId },
    });
  }

  if (spec.unavailable) {
    return finish({
      status: 503,
      message: "catalog_unavailable",
      lockWaitMs: null,
      lockHoldMs: null,
      queueDepth: null,
      spans: [
        {
          name: "GET /products/:id",
          startOffsetMs: 0,
          durationMs: roundMs(performance.now() - started),
          attributes: { error: "catalog_unavailable" },
        },
      ],
      body: { error: "catalog_unavailable", traceId, productId },
    });
  }

  const acquired = state.mutex.tryAcquire() ?? (await state.mutex.acquire());
  const waitMs = roundMs(acquired.waitMs);
  const holdStarted = performance.now();
  let holdMs = 0;
  try {
    if (spec.workPlacement === "inside-lock") {
      // Defect path: the slow read stays inside the exclusive lock, so
      // overlapping callers wait for the whole timer. The timer stands in
      // for an expensive critical section. It is not a captured production profile.
      await sleep(scenario.workMs);
    }
  } finally {
    holdMs = roundMs(performance.now() - holdStarted);
    state.mutex.release();
  }

  let outsideMs = 0;
  if (spec.workPlacement === "outside-lock") {
    const outsideStarted = performance.now();
    await sleep(scenario.workMs);
    outsideMs = roundMs(performance.now() - outsideStarted);
  }

  const serverDurationMs = roundMs(performance.now() - started);
  const readSpan =
    spec.workPlacement === "inside-lock"
      ? {
          name: "catalog.read",
          startOffsetMs: waitMs,
          durationMs: holdMs,
          attributes: { lockHeld: true, scheduledWorkMs: scenario.workMs },
        }
      : {
          name: "catalog.read",
          startOffsetMs: roundMs(waitMs + holdMs),
          durationMs: outsideMs,
          attributes: { lockHeld: false, scheduledWorkMs: scenario.workMs },
        };

  return finish({
    status: 200,
    message: "catalog_request",
    lockWaitMs: waitMs,
    lockHoldMs: holdMs,
    queueDepth: acquired.queueDepthAtAcquire,
    spans: [
      { name: "GET /products/:id", startOffsetMs: 0, durationMs: serverDurationMs, attributes: { mode } },
      {
        name: "catalog.lock.wait",
        startOffsetMs: 0,
        durationMs: waitMs,
        attributes: { queueDepthAtAcquire: acquired.queueDepthAtAcquire },
      },
      {
        name: "catalog.lock.hold",
        startOffsetMs: waitMs,
        durationMs: holdMs,
        attributes: { workPlacement: spec.workPlacement },
      },
      readSpan,
    ],
    body: {
      product: { ...product, availability: "in_stock" },
      traceId,
      mode,
      workPlacement: spec.workPlacement,
    },
  });
}
// nexus-source-end: readProduct

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body was not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

export function createCatalogServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://catalog.local");
      const { pathname } = url;

      if (req.method === "GET" && pathname === "/health") {
        const spec = modeSpec(state.mode);
        sendJson(res, 200, {
          ok: true,
          service: "nexus-sandbox-catalog",
          scenario: scenario.id,
          mode: state.mode,
          workPlacement: spec.workPlacement,
          workMs: scenario.workMs,
          uptimeSeconds: Math.round((Date.now() - state.startedAt) / 1000),
        });
        return;
      }

      if (req.method === "GET" && pathname === "/products") {
        sendJson(res, 200, { products: scenario.products });
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/products/")) {
        const productId = decodeURIComponent(pathname.slice("/products/".length));
        const result = await readProduct(productId);
        sendJson(res, result.status, result.body, result.headers);
        return;
      }

      if (req.method === "GET" && pathname === "/admin/telemetry") {
        sendJson(res, 200, {
          mode: state.mode,
          maxQueueDepth: state.mutex.maxQueueDepth,
          logs: state.logs,
          traces: state.traces,
          requests: state.requests,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/admin/reset") {
        resetState();
        sendJson(res, 200, { ok: true, mode: state.mode });
        return;
      }

      if (req.method === "POST" && pathname === "/admin/mode") {
        const body = await readJson(req);
        if (!["baseline", "incident", "remediated", "unavailable"].includes(body.mode)) {
          sendJson(res, 400, { error: "mode must be baseline, incident, remediated, or unavailable" });
          return;
        }
        state.mode = body.mode;
        sendJson(res, 200, { ok: true, mode: state.mode, workPlacement: modeSpec(state.mode).workPlacement });
        return;
      }

      sendJson(res, 404, { error: "not_found", path: pathname });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "catalog_error" });
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.CATALOG_PORT ?? 4318);
  const host = process.env.CATALOG_HOST ?? "127.0.0.1";
  const server = createCatalogServer();
  server.listen(port, host, () => {
    console.log(`nexus sandbox catalog listening on http://${host}:${port} scenario=${scenario.id}`);
  });
}
