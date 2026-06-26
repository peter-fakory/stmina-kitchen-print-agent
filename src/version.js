// src/version.js
// Single source of truth for the agent's version.
// Bump this before tagging a new GitHub Release — the POS/KDS compares
// this value (reported via GET /health) against the latest GitHub release tag.
const VERSION = "1.0.5";

module.exports = { VERSION };
