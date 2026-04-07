#!/usr/bin/env node
/**
 * payload-key-contract-guard.mjs
 *
 * Enforces snake_case-only payload keys in edge functions.
 * Detects camelCase keys in job payloads that could cause
 * silent guard/filter mismatches (e.g. blueprintId vs blueprint_id).
 *
 * Scans: supabase/functions/**\/*.ts
 * Fails on: camelCase keys in payload objects destined for job_queue inserts
 */

import fs from "node:fs";
import path from "node:path";

const FUNCTIONS_DIR = path.resolve("supabase/functions");

// Known camelCase payload keys that MUST be snake_case
const BANNED_PAYLOAD_KEYS = [
  "blueprintId",
  "packageId",
  "courseId",
  "curriculumId",
  "subjectName",
  "isStudium",
  "learningFieldId",
  "competencyId",
];

// Patterns that indicate payload construction for job_queue
const PAYLOAD_CONTEXT_PATTERNS = [
  /payload\s*:\s*\{/,
  /payload\s*=\s*\{/,
  /\.insert\(\s*\{[^}]*payload/,
];

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const violations = [];

  let inPayloadBlock = false;
  let braceDepth = 0;
  let payloadStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Detect payload block start
    if (!inPayloadBlock) {
      for (const pat of PAYLOAD_CONTEXT_PATTERNS) {
        if (pat.test(line)) {
          inPayloadBlock = true;
          braceDepth = 0;
          payloadStartLine = lineNum;
          // Count opening braces from the payload key onward
          const payloadMatch = line.match(/payload\s*[:=]\s*\{/);
          if (payloadMatch) {
            const afterPayload = line.slice(line.indexOf(payloadMatch[0]));
            braceDepth += (afterPayload.match(/\{/g) || []).length;
            braceDepth -= (afterPayload.match(/\}/g) || []).length;
          }
          break;
        }
      }
    }

    if (inPayloadBlock) {
      // Track brace depth (skip the line that started the block)
      if (lineNum !== payloadStartLine) {
        braceDepth += (line.match(/\{/g) || []).length;
        braceDepth -= (line.match(/\}/g) || []).length;
      }

      // Check for banned camelCase keys
      for (const key of BANNED_PAYLOAD_KEYS) {
        // Match key as an object property (e.g. `blueprintId:` or `blueprintId,`)
        const keyPattern = new RegExp(`\\b${key}\\s*[:=,]`);
        if (keyPattern.test(line)) {
          // Exclude comments
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
          
          // Exclude lines that are reading/normalizing (e.g. p.blueprintId ?? p.blueprint_id)
          if (line.includes("??") && line.includes("blueprint_id")) continue;
          if (line.includes("?.") || line.includes("as any)?.")) continue;

          violations.push({
            file: filePath,
            line: lineNum,
            key,
            text: trimmed,
            suggestion: key.replace(/([A-Z])/g, "_$1").toLowerCase(),
          });
        }
      }

      if (braceDepth <= 0) {
        inPayloadBlock = false;
      }
    }
  }

  return violations;
}

function walkDir(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...walkDir(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

// ── Main ──
const files = walkDir(FUNCTIONS_DIR);
const allViolations = [];

for (const f of files) {
  allViolations.push(...scanFile(f));
}

if (allViolations.length > 0) {
  console.error(`\n❌ payload-key-contract-guard: ${allViolations.length} camelCase payload key(s) found\n`);
  console.error("Job payloads MUST use snake_case keys to prevent silent filter mismatches.\n");
  console.error("Ref: Incident April 2026 — blueprintId vs blueprint_id caused undetected re-entry loop.\n");

  for (const v of allViolations) {
    const rel = path.relative(process.cwd(), v.file);
    console.error(`  ${rel}:${v.line}  "${v.key}" → use "${v.suggestion}" instead`);
    console.error(`    ${v.text}\n`);
  }

  process.exit(1);
} else {
  console.log("✅ payload-key-contract-guard: all payload keys are snake_case");
}
