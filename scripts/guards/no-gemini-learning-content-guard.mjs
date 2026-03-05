#!/usr/bin/env node
/**
 * No-Gemini-in-Learning-Content Guard
 *
 * Prevents regression: Gemini must NEVER appear in any routing/selector
 * context for the `learning_content` intent. Tool-parse failures on
 * Lovable proxy make Gemini unsuitable for this pipeline path.
 *
 * Scans: supabase/functions/, src/
 * Checks: If a file references `learning_content` AND `gemini` in the
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
 * Stricter check: we look for lines where learning_content intent is
 * being SET/SELECTED (not just mentioned in a comment or type definition).
 * Then we check if the same file has gemini in a model/provider context.
 */
const LEARNING_CONTENT_SELECTOR = /learning_content/;
const GEMINI_MODEL_REF = /["'](?:google\/)?gemini[^"']*/i;

// Patterns that indicate the gemini ref is in a routing/model context (not just a comment or filter)
const GEMINI_ROUTING_PATTERNS = [
  /model:\s*["'][^"']*gemini/i,
  /model.*gemini/i,
  /provider.*google/i,
  /["']google\/gemini/i,
];

let violations = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (isAllowlisted(file)) continue;

    const src = fs.readFileSync(file, "utf8");

    // Must reference learning_content as an intent selector
    if (!LEARNING_CONTENT_SELECTOR.test(src)) continue;

    // Check if file has gemini in a routing context
    const lines = src.split("\n");
    const geminiLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip pure comments
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      // Skip lines that are filtering OUT gemini (e.g. `!c.model.includes("gemini")`)
      if (trimmed.includes("!") && trimmed.includes("gemini") && trimmed.includes("filter")) continue;
      if (trimmed.includes("!c.model.includes") && trimmed.includes("gemini")) continue;

      // Check for gemini in model/routing context
      for (const pat of GEMINI_ROUTING_PATTERNS) {
        if (pat.test(line)) {
          // Now check: is this line within a learning_content block?
          // Heuristic: check surrounding 15 lines for learning_content
          const blockStart = Math.max(0, i - 15);
          const blockEnd = Math.min(lines.length - 1, i + 5);
          const block = lines.slice(blockStart, blockEnd + 1).join("\n");

          if (/learning_content/.test(block)) {
            geminiLines.push({ line: i + 1, content: trimmed.slice(0, 120) });
            break;
          }
        }
      }
    }

    if (geminiLines.length > 0) {
      violations.push({ file, hits: geminiLines });
    }
  }
}

if (violations.length > 0) {
  console.error("\n❌ NO-GEMINI-IN-LEARNING-CONTENT Guard FAILED\n");
  console.error("Gemini must not be used for 'learning_content' intent (tool-parse failures on proxy).\n");
  for (const v of violations) {
    console.error(`  📄 ${v.file}`);
    for (const h of v.hits) {
      console.error(`     L${h.line}: ${h.content}`);
    }
  }
  console.error("\nFix: Replace gemini models with openai/* in learning_content routing chains.\n");
  process.exit(1);
}

console.log("✅ No-Gemini-in-Learning-Content Guard passed.");
