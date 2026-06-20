// src/printer.js
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { getBaseDir } = require("./paths");

// printer.ps1 is bundled inside the pkg snapshot (read-only, not a real OS
// path) but powershell.exe — an external process — needs a real file on
// disk. Extract it once to the real base dir alongside the .exe/config.
function ensurePs1OnDisk() {
  const realPath = path.join(getBaseDir(), "printer.ps1");
  const snapshotPath = path.join(__dirname, "printer.ps1");
  const contents = fs.readFileSync(snapshotPath, "utf8");
  fs.writeFileSync(realPath, contents, "utf8");
  return realPath;
}

function runPrinterScript(args) {
  return new Promise((resolve, reject) => {
    const ps1Path = ensurePs1OnDisk();
    const fullArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1Path, ...args];

    const child = spawn("powershell.exe", fullArgs, { windowsHide: true });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => reject(err));

    child.on("close", (code) => {
      if (code !== 0) {
        const msg = [`PowerShell exit code ${code}`, stderr.trim(), stdout.trim()]
          .filter(Boolean)
          .join("\n\n");
        return reject(new Error(msg));
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        reject(new Error(`Failed to parse printer script output: ${stdout.trim()}`));
      }
    });
  });
}

function printTextFile(printerName, filePath, { cutN = 2, receiptCpl = 48 } = {}) {
  return runPrinterScript([
    "-PrinterName", printerName,
    "-Action", "print",
    "-FilePath", filePath,
    "-CutN", String(cutN),
    "-ReceiptCpl", String(receiptCpl),
  ]);
}

function kickDrawer(printerName) {
  return runPrinterScript(["-PrinterName", printerName, "-Action", "drawer-kick"]);
}

function getPrinterStatus(printerName) {
  return runPrinterScript(["-PrinterName", printerName, "-Action", "status"]);
}

function listPrinters() {
  return runPrinterScript(["-Action", "list-printers"]);
}

module.exports = { printTextFile, kickDrawer, getPrinterStatus, listPrinters };
