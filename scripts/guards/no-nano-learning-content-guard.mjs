#!/usr/bin/env node
/**
 * No-Nano-in-Learning-Content Guard (v2)
 *
 * Prevents regression: gpt-5-nano must NEVER appear in any routing/selector
 * context for the `learning_content` intent. Nano returns empty responses
 * consistently for structured lesson JSON.
 *
 * Gemini IS allowed as a plain-JSON fallback (tool-calling is OFF for
 * learning_content, so Gemini parse issues don't apply).
 *
 * Scans: supabase/functions/, src/
 * Checks: If a file references `learning_content` AND `nano` in the
 *         same routing/model context → FAIL.
 */
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["supabase/functions", "src"];
const EXTS = new Set([".ts", ".tsx", ".js", ".mjs"]);

// Files that are allowed to mention both (e.g. token pricing tables, comments-only)
const ALLOWLIST = [
  "token-estimator.ts",   // pricing table lists all models
  "provider-rate-limiter", // type definitions
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory() && !ent.name.startsWith(".") && ent.name !== "node_modules") {
      walk(p, out);
    } else if (EXTS.has(path.extname(ent.name))) {
      out.push(p);
    }
  }
  return out;
}

function isAllowlisted(filePath) {
  const norm = filePath.replaceAll("\\", "/");
  return ALLOWLIST.some((a) => norm.includes(a));
}

/**
 * Check: learning_content intent must NOT reference gpt-5-nano.
 * Nano produces empty responses for structured lesson JSON.
 */
const LEARNING_CONTENT_SELECTOR = /learning_content/;
const NANO_MODEL_REF = /nano/i;

const NANO_ROUTING_PATTERNS = [
  /model:\s*["'][^"']*nano/i,
  /model.*nano/i,
  /["']openai\/gpt-5-nano/i,
  /["']gpt-5-nano/i,
];

let violations = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (isAllowlisted(file)) continue;

    const src = fs.readFileSync(file, "utf8");

    // Must reference learning_content as an intent selector
    if (!LEARNING_CONTENT_SELECTOR.test(src)) continue;

    // Check if file has nano in a routing context
    const lines = src.split("\n");
    const nanoLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip pure comments
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      // Skip lines that are filtering OUT nano
      if (trimmed.includes("!") && trimmed.includes("nano") && trimmed.includes("filter")) continue;

      // Check for nano in model/routing context
      for (const pat of NANO_ROUTING_PATTERNS) {
        if (pat.test(line)) {
          // Now check: is this line within a learning_content block?
          const blockStart = Math.max(0, i - 15);
          const blockEnd = Math.min(lines.length - 1, i + 5);
          const block = lines.slice(blockStart, blockEnd + 1).join("\n");

          if (/learning_content/.test(block)) {
            nanoLines.push({ line: i + 1, content: trimmed.slice(0, 120) });
            break;
          }
        }
      }
    }

    if (nanoLines.length > 0) {
      violations.push({ file, hits: nanoLines });
    }
  }
}

if (violations.length > 0) {
  console.error("\n❌ NO-NANO-IN-LEARNING-CONTENT Guard FAILED\n");
  console.error("gpt-5-nano must not be used for 'learning_content' intent (empty response failures).\n");
  for (const v of violations) {
    console.error(`  📄 ${v.file}`);
    for (const h of v.hits) {
      console.error(`     L${h.line}: ${h.content}`);
    }
  }
  console.error("\nFix: Replace nano models with gpt-5-mini/gpt-5/gemini-2.5-flash in learning_content routing.\n");
  process.exit(1);
}

console.log("✅ No-Nano-in-Learning-Content Guard passed.");
