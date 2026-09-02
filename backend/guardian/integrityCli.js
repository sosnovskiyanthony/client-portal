#!/usr/bin/env node
// `npm run guardian:integrity:check` / `npm run guardian:integrity:update`.
// See guardian/integrityCheck.js's module comment for what this does and
// does not guarantee.
"use strict";

const { checkIntegrity, writeManifest, MANIFEST_PATH } = require("./integrityCheck");

const mode = process.argv[2];

if (mode === "update") {
  writeManifest();
  console.log(`Updated ${MANIFEST_PATH}.`);
  process.exit(0);
}

if (mode === "check") {
  const result = checkIntegrity();
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.ok) {
    console.log("Guardian integrity check: OK — all protected files match the committed manifest.");
    process.exit(0);
  }
  console.error("Guardian integrity check: DRIFT DETECTED.");
  if (result.drifted.length > 0) {
    console.error(`  Modified (hash mismatch): ${result.drifted.join(", ")}`);
  }
  if (result.missing.length > 0) {
    console.error(`  Missing: ${result.missing.join(", ")}`);
  }
  if (result.extra.length > 0) {
    console.error(`  Not yet in the committed manifest (list changed?): ${result.extra.join(", ")}`);
  }
  console.error('If this drift is a legitimate, deliberate change, run `npm run guardian:integrity:update` and commit the updated manifest.');
  process.exit(1);
}

console.error("Usage: node guardian/integrityCli.js <check|update>");
process.exit(1);
