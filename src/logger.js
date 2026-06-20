// src/logger.js
// Structured JSON-lines logging for print/drawer/health events so printer
// issues can be diagnosed remotely without needing physical access to the POS PC.
const fs = require("fs");
const path = require("path");
const { getBaseDir } = require("./paths");

const LOG_DIR = path.join(getBaseDir(), "logs");
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5MB per file before rotation
const MAX_ROTATED_FILES = 5;

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function currentLogPath() {
  return path.join(LOG_DIR, "agent.log");
}

function rotateIfNeeded() {
  const logPath = currentLogPath();
  if (!fs.existsSync(logPath)) return;

  const { size } = fs.statSync(logPath);
  if (size < MAX_LOG_BYTES) return;

  // Shift agent.log.4 -> deleted, agent.log.3 -> .4, ... agent.log -> .1
  for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
    const src = `${logPath}.${i}`;
    const dest = `${logPath}.${i + 1}`;
    if (fs.existsSync(src)) {
      if (i + 1 > MAX_ROTATED_FILES) fs.unlinkSync(src);
      else fs.renameSync(src, dest);
    }
  }
  fs.renameSync(logPath, `${logPath}.1`);
}

function log(event, data = {}) {
  rotateIfNeeded();
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };
  fs.appendFileSync(currentLogPath(), JSON.stringify(entry) + "\n", "utf8");
  // Also echo to stdout for live debugging when run interactively
  console.log(`[${entry.ts}] ${event}`, data);
}

module.exports = { log, LOG_DIR, currentLogPath };
