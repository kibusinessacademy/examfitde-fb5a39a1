#!/usr/bin/env node
// CLI shim: `report-status.mjs <stage>`. Used by workflow steps that don't
// need to compute extra metadata.
import { report } from "./_report.mjs";
const stage = process.argv[2] || "unknown";
const status = stage.endsWith("_failed") || stage === "missing_secrets" ? "error" : "ok";
await report(stage === "final" ? "build_succeeded" : stage, status);
