// src/config.js
// Local agent configuration — printer name is chosen once during install
// (or manually edited here) and persisted to a JSON file beside the agent.
const fs = require("fs");
const path = require("path");
const { getBaseDir } = require("./paths");

const CONFIG_PATH = path.join(getBaseDir(), "agent-config.json");

const DEFAULTS = {
  port: 9100,
  printerName: "",
  allowedOrigins: [
    "https://stmina-pos.createfy.ca",
  ],
  cutN: 2,
  receiptCpl: 48,
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULTS);
    return { ...DEFAULTS };
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

module.exports = { loadConfig, saveConfig, CONFIG_PATH };
