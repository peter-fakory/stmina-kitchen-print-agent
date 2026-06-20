# St Mina Kitchen Print Agent

A small local Windows agent that gives browser-based apps (POS, and later KDS) direct, silent access to a USB receipt printer and its attached cash drawer — no browser print dialogs, no certificate management.

## How it works

The agent runs as a tiny local HTTP server on `http://127.0.0.1:9100`. Browsers treat `localhost` as an exception to mixed-content blocking, so an HTTPS-hosted web app can call it directly with no certificates involved.

```
Cloud web app (POS/KDS)
      │ POST /print, POST /drawer/kick, GET /health
      ▼
This agent (local HTTP server)
      │ spawns printer.ps1
      ▼
winspool.Drv RAW write → physical printer (+ drawer kick via printer)
```

Printing uses the exact same RAW Win32 technique (`winspool.Drv` via P/Invoke) and Star Line Mode `[[BIG]]` marker formatting already proven in `stmina-gateway`.

## Endpoints

- `GET /health` — reports `{ agentRunning, version, printerName, printerFound, printerStatus }`
- `POST /print` — body `{ receiptText, orderCode }`
- `POST /drawer/kick` — sends the cash drawer kick command through the printer

## First run

No separate installer — just run the `.exe`. On first launch it:
1. Lists installed Windows printers and asks which one to use
2. Saves that choice to `agent-config.json` next to the `.exe`
3. Registers itself to auto-start at login (`HKCU\...\Run`)

From then on it starts silently in the background on every login.

## Logs

Structured JSON-lines logs are written to `logs/agent.log` (rotated at 5MB, keeps last 5 files) next to the `.exe`, covering every print/drawer-kick attempt with Win32 error codes and printer status — for remote troubleshooting without needing physical access to the POS PC.

## Building the Windows executable

Building happens via GitHub Actions on a `windows-latest` runner (cross-compiling from macOS hits flaky prebuilt binary caches). Push a version tag (e.g. `v1.0.0`) and the workflow in `.github/workflows/release.yml` builds `dist/StMinaPrintAgent.exe` and attaches it to a new GitHub Release automatically.

## Versioning

The agent's version lives in `src/version.js`. Consuming apps (POS, KDS) compare the version reported by `/health` against the latest tag on this repo's GitHub Releases to detect when an update is available.
