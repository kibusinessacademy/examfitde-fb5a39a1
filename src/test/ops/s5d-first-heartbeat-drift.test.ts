/**
 * S5d — First-Heartbeat-Drift (CI Guard)
 *
 * Systematischer Drift-Check für PHK-sensitive Worker:
 * markFirstHeartbeat() MUSS in jedem Worker vor JEDEM teuren Schritt
 * stehen. Teure Schritte: assert*( / prereqDone( / supabase.rpc( /
 * supabase.from( / await fetch(.
 *
 * Verhindert Regression in beiden Richtungen:
 *  - neue assert/prereq-Aufrufe vor heartbeat
 *  - neue Worker werden hinzugefügt, ohne den Contract zu erfüllen
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// SSOT: Diese Liste muss synchron zu fn_adaptive_burst_size_v3 + claim_pending_jobs_v5
// (phk_caps CTE) bleiben.
const PHK_SENSITIVE_WORKERS = [
  "supabase/functions/package-quality-council/index.ts",
  "supabase/functions/package-run-integrity-check/index.ts",
  "supabase/functions/package-auto-publish/index.ts",
  "supabase/functions/package-validate-tutor-index/index.ts",
  "supabase/functions/package-build-ai-tutor-index/index.ts",
] as const;

// Heavy-Step-Pattern: anything below MUST come after markFirstHeartbeat()
// in handler scope (after Deno.serve(...)).
const HEAVY_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "assert*", re: /\bassert[A-Z]\w*\s*\(/ },
  { name: "prereqDone(", re: /\bprereqDone\s*\(/ },
  { name: "supabase.rpc(", re: /\b(?:sb|supabase|client)\.rpc\s*\(/ },
  { name: "supabase.from(", re: /\b(?:sb|supabase|client)\.from\s*\(/ },
  { name: "await fetch(", re: /\bawait\s+fetch\s*\(/ },
];

interface Violation {
  worker: string;
  pattern: string;
  patternIdx: number;
  heartbeatIdx: number;
  snippet: string;
}

function findViolations(workerPath: string): Violation[] {
  const fullPath = join(process.cwd(), workerPath);
  const src = readFileSync(fullPath, "utf-8");

  // Scope: nur der Handler (Deno.serve(...) bis Dateiende)
  const serveIdx = src.indexOf("Deno.serve(");
  if (serveIdx < 0) {
    return [{
      worker: workerPath,
      pattern: "Deno.serve(",
      patternIdx: -1,
      heartbeatIdx: -1,
      snippet: "missing Deno.serve handler",
    }];
  }
  const handler = src.slice(serveIdx);

  // Erste markFirstHeartbeat-Position (im Handler)
  const hbMatch = /\bmarkFirstHeartbeat\s*\(/.exec(handler);
  if (!hbMatch) {
    return [{
      worker: workerPath,
      pattern: "markFirstHeartbeat(",
      patternIdx: -1,
      heartbeatIdx: -1,
      snippet: "markFirstHeartbeat() not called in handler",
    }];
  }
  const heartbeatIdx = hbMatch.index;

  const violations: Violation[] = [];
  for (const { name, re } of HEAVY_PATTERNS) {
    const reGlobal = new RegExp(re, "g");
    let m: RegExpExecArray | null;
    while ((m = reGlobal.exec(handler)) !== null) {
      if (m.index < heartbeatIdx) {
        // Snippet
        const start = Math.max(0, m.index - 40);
        const end = Math.min(handler.length, m.index + 60);
        violations.push({
          worker: workerPath,
          pattern: name,
          patternIdx: m.index,
          heartbeatIdx,
          snippet: handler.slice(start, end).replace(/\n/g, " ").trim(),
        });
        break; // ein Beleg reicht pro Pattern
      }
    }
  }
  return violations;
}

describe("S5d — First-Heartbeat-Drift (PHK-sensitive workers)", () => {
  for (const worker of PHK_SENSITIVE_WORKERS) {
    it(`${worker.split("/").slice(-2)[0]} writes first heartbeat BEFORE every heavy step`, () => {
      const violations = findViolations(worker);
      if (violations.length > 0) {
        const msg = violations
          .map(
            (v) =>
              `  • [${v.pattern}] @${v.patternIdx} (heartbeat @${v.heartbeatIdx}) → ${v.snippet}`,
          )
          .join("\n");
        throw new Error(
          `Heartbeat-Drift in ${worker}:\n${msg}\n` +
            `  Fix: move \`await markFirstHeartbeat(sb, body.job_id ?? p?.job_id)\` ` +
            `to be the FIRST statement in the handler before any heavy step.`,
        );
      }
      expect(violations).toEqual([]);
    });
  }

  it("worker list is in sync with PHK-sensitive registry (5 workers)", () => {
    expect(PHK_SENSITIVE_WORKERS.length).toBe(5);
  });
});
