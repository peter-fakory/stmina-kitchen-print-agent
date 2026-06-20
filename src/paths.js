// src/paths.js
// Resolves a real, on-disk base directory for config/logs/extracted assets.
// When packaged with pkg, __dirname points into a virtual read-only snapshot
// that external processes (powershell.exe) cannot access — so packaged builds
// must anchor to the real directory containing the .exe instead.
const path = require("path");

function getBaseDir() {
  if (process.pkg) {
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, "..");
}

module.exports = { getBaseDir };
