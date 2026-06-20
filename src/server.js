// src/server.js
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { VERSION } = require("./version");
const { loadConfig } = require("./config");
const { log } = require("./logger");
const { printTextFile, kickDrawer, getPrinterStatus } = require("./printer");
const { ensureFirstRunSetupComplete } = require("./setup");

let config = loadConfig();
const app = express();

// Accept the configured production origin(s) plus any *.workers.dev test
// deployment under this account, so feature-branch testing isn't blocked by CORS.
const TEST_ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+\.peter-fakory\.workers\.dev$/i;

function isAllowedOrigin(origin) {
  if (!origin) return true; // non-browser tools (curl, health checks)
  if (config.allowedOrigins.includes(origin)) return true;
  return TEST_ORIGIN_PATTERN.test(origin);
}

app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      callback(new Error(`Origin not allowed: ${origin}`));
    },
  })
);

// GET /health — POS/KDS polls this to detect the agent + printer state
app.get("/health", async (req, res) => {
  let printerStatus = null;
  let printerFound = false;

  try {
    printerStatus = await getPrinterStatus(config.printerName);
    printerFound = !!printerStatus.printerFound;
  } catch (e) {
    log("health_check_error", { error: e.message });
  }

  res.json({
    agentRunning: true,
    version: VERSION,
    printerName: config.printerName,
    printerFound,
    printerStatus,
  });
});

// POST /print — body: { receiptText: string, orderCode?: string }
app.post("/print", async (req, res) => {
  const { receiptText, orderCode } = req.body || {};

  if (!receiptText || typeof receiptText !== "string") {
    return res.status(400).json({ ok: false, error: "Missing receiptText" });
  }
  if (!config.printerName) {
    return res.status(400).json({ ok: false, error: "No printer configured on this agent" });
  }

  const tmpPath = path.join(os.tmpdir(), `print-agent-${orderCode || Date.now()}.txt`);

  try {
    fs.writeFileSync(tmpPath, receiptText, "utf8");
    log("print_start", { orderCode, printerName: config.printerName });

    const result = await printTextFile(config.printerName, tmpPath, {
      cutN: config.cutN,
      receiptCpl: config.receiptCpl,
    });

    log("print_success", { orderCode, ...result });
    res.json({ ok: true, ...result });
  } catch (e) {
    log("print_error", { orderCode, error: e.message });
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    fs.unlink(tmpPath, () => {});
  }
});

// POST /drawer/kick
app.post("/drawer/kick", async (req, res) => {
  if (!config.printerName) {
    return res.status(400).json({ ok: false, error: "No printer configured on this agent" });
  }

  try {
    log("drawer_kick_start", { printerName: config.printerName });
    const result = await kickDrawer(config.printerName);
    log("drawer_kick_success", result);
    res.json({ ok: true, ...result });
  } catch (e) {
    log("drawer_kick_error", { error: e.message });
    res.status(500).json({ ok: false, error: e.message });
  }
});

async function main() {
  config = await ensureFirstRunSetupComplete();

  app.listen(config.port, "127.0.0.1", () => {
    log("agent_started", { version: VERSION, port: config.port, printerName: config.printerName });
    console.log(`StMina Print Agent v${VERSION} listening on http://127.0.0.1:${config.port}`);
  });
}

main().catch((e) => {
  log("agent_startup_error", { error: e.message });
  console.error("Failed to start agent:", e.message);
  process.exit(1);
});
