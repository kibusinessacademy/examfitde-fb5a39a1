#!/usr/bin/env node
/**
 * payload-key-contract-guard.mjs
 *
 * Enforces snake_case-only KEYS in job payload objects within edge functions.
 * Detects camelCase KEYS (not values) that could cause silent guard/filter mismatches.
 *
 * Ref: Incident April 2026 — blueprintId vs blueprint_id caused undetected re-entry loop.
 *
 * Scans: supabase/functions/**/*.ts
 */

import fs from "node:fs";
import path from "node:path";

const FUNCTIONS_DIR = path.resolve("supabase/functions");

// camelCase keys that MUST be snake_case when used as payload object keys
const BANNED_KEYS = [
  "blueprintId",
  "packageId",
  "courseId",
  "curriculumId",
  "subjectName",
  "isStudium",
  "learningFieldId",
  "competencyId",
];

// Build regex: match `key:` or `key,` at start of a property (the KEY position in an object literal)
// Must NOT match `some_snake: camelVar` — only `camelKey: value`
const KEY_REGEXES = BANNED_KEYS.map(k => ({
  key: k,
  // Matches: `  camelKey:` or `  camelKey,` (shorthand property in object literal)
  pattern: new RegExp(`^\\s*${k}\\s*[:],?`, "m"),
  suggestion: k.replace(/([A-Z])/g, "_$1").toLowerCase(),
}));

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const violations = [];

  let inPayloadBlock = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    // Detect payload block start
    if (!inPayloadBlock && /payload\s*[:=]\s*\{/.test(line)) {
      inPayloadBlock = true;
      braceDepth = 1;
      continue;
    }

    if (inPayloadBlock) {
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;

      if (braceDepth <= 0) {
        inPayloadBlock = false;
        continue;
      }

      // Check if this line has a camelCase KEY (not value)
      // Pattern: the line starts with optional whitespace, then the key, then `:` or `,`
      for (const { key, suggestion } of KEY_REGEXES) {
        // Match: `  blueprintId:` or `  blueprintId,` (shorthand)
        const keyAsPropertyName = new RegExp(`^\\s*${key}\\s*[,:}]`);
        const keyAsPropertyKey = new RegExp(`^\\s*${key}\\s*:`);
        
        if (keyAsPropertyKey.test(trimmed) || (keyAsPropertyName.test(trimmed) && !trimmed.includes(":"))) {
          // Exclude normalization lines (reading from payload)
          if (line.includes("??") || line.includes("||")) continue;
          
          violations.push({
            file: filePath,
            line: lineNum,
            key,
            text: trimmed,
            suggestion,
          });
        }
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
  console.error(`\n❌ payload-key-contract-guard: ${allViolations.length} camelCase payload KEY(s) found\n`);
  console.error("Job payload keys MUST use snake_case to prevent silent filter mismatches.");
  console.error("Ref: Incident April 2026 — blueprintId vs blueprint_id caused undetected re-entry loop.\n");

  for (const v of allViolations) {
    const rel = path.relative(process.cwd(), v.file);
    console.error(`  ${rel}:${v.line}  "${v.key}" → use "${v.suggestion}"`);
    console.error(`    ${v.text}\n`);
  }

  process.exit(1);
} else {
  console.log("✅ payload-key-contract-guard: all payload keys are snake_case");
}
