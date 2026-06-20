// src/setup.js
// First-run setup: if no printer is configured yet, list installed Windows
// printers, ask the operator to pick one, save it, then register the agent
// to auto-start at login. Runs automatically — no separate installer needed.
const readline = require("readline");
const { spawn } = require("child_process");
const { loadConfig, saveConfig } = require("./config");
const { listPrinters } = require("./printer");
const { log } = require("./logger");

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

async function pickPrinterInteractively() {
  const { printers } = await listPrinters();

  if (!printers || printers.length === 0) {
    throw new Error("No Windows printers found. Connect/install the printer first, then restart this agent.");
  }

  console.log("\nAvailable printers:");
  printers.forEach((name, i) => console.log(`  ${i + 1}. ${name}`));

  let choice = null;
  while (choice === null) {
    const answer = await ask(`\nWhich printer should St Mina Print Agent use? (1-${printers.length}): `);
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < printers.length) choice = printers[idx];
    else console.log("Invalid choice, try again.");
  }

  return choice;
}

function registerAutoStart() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(false);

    const exePath = process.pkg ? process.execPath : process.argv[0];
    const child = spawn("reg.exe", [
      "add",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
      "/v", "StMinaPrintAgent",
      "/t", "REG_SZ",
      "/d", `"${exePath}"`,
      "/f",
    ], { windowsHide: true });

    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function ensureFirstRunSetupComplete() {
  const config = loadConfig();
  if (config.printerName) return config;

  console.log("\nFirst run detected — no printer configured yet.\n");
  const printerName = await pickPrinterInteractively();

  const updated = { ...config, printerName };
  saveConfig(updated);
  log("setup_printer_selected", { printerName });

  const registered = await registerAutoStart();
  log("setup_autostart_registered", { registered });
  if (registered) {
    console.log("\nAgent registered to start automatically at login.");
  } else {
    console.log("\nCould not register auto-start automatically — you may need to add it manually.");
  }

  console.log(`\nSetup complete. Using printer: ${printerName}\n`);
  return updated;
}

module.exports = { ensureFirstRunSetupComplete };
