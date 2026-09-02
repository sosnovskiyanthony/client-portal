#!/usr/bin/env node
// The fastest, no-website, no-redeploy way to change BrindLeaf's AI state —
// see guardian/README.md's emergency runbook. Connects directly to
// DATABASE_URL (the same production database the deployed app uses) and
// writes a new ai_control_state row via guardian/aiControl.js's own
// setAiState() — no HTTP, no admin JWT, no running server required. Since
// there is no caching layer anywhere in aiControl.js, this takes effect on
// the very next AI call the running production server makes.
//
// Usage (from any machine with the production DATABASE_URL — e.g. via
// `railway run node guardian/setAiState.js disable --reason "..."`, or
// locally with DATABASE_URL exported to point at production):
//
//   node guardian/setAiState.js status
//   node guardian/setAiState.js enable  --reason "Incident resolved"
//   node guardian/setAiState.js disable --reason "Investigating unexpected output"
//   node guardian/setAiState.js lockdown --reason "Manual emergency lockdown"
//
// This is a human/infrastructure-only tool. Nothing in the AI-facing code
// path ever invokes this script or the module it wraps with a mutating
// argument — see guardian/aiControl.js's own module comment for the trust
// hierarchy this sits at the top of.
"use strict";

const { pool } = require("../config/database");
const aiControl = require("./aiControl");

function parseArgs(argv) {
  const command = argv[0];
  let reason = null;
  const reasonIdx = argv.indexOf("--reason");
  if (reasonIdx !== -1 && argv[reasonIdx + 1]) {
    reason = argv.slice(reasonIdx + 1).join(" ");
  }
  return { command, reason };
}

async function main() {
  const { command, reason } = parseArgs(process.argv.slice(2));
  const validCommands = ["status", "enable", "disable", "lockdown"];

  if (!validCommands.includes(command)) {
    console.error(`Usage: node guardian/setAiState.js <${validCommands.join("|")}> [--reason "..."]`);
    process.exitCode = 1;
    await pool.end();
    return;
  }

  if (command === "status") {
    const state = await aiControl.getAiState();
    console.log(JSON.stringify(state, null, 2));
    await pool.end();
    return;
  }

  const targetState = { enable: "ENABLED", disable: "DISABLED", lockdown: "LOCKDOWN" }[command];
  try {
    const result = await aiControl.setAiState({
      state: targetState,
      reason: reason || `Set via guardian/setAiState.js CLI (no reason given).`,
      source: "cli",
    });
    console.log(`AI state set to ${result.state}.`);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`Failed to set AI state: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("guardian/setAiState.js crashed:", err);
  process.exitCode = 1;
});
