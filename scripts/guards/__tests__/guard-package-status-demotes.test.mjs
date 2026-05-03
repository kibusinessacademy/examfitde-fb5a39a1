#!/usr/bin/env node
/**
 * Integration test for guard-package-status-demotes.mjs
 *
 * Feeds representative source blocks via temp files and asserts:
 *   - SAFE cases (gated / commented) are allowed
 *   - UNSAFE cases (raw building→queued demote) are blocked
 *
 * Run: node scripts/guards/__tests__/guard-package-status-demotes.test.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const guardSrc = "scripts/guards/guard-package-status-demotes.mjs";

const CASES = [
  {
    name: "UNSAFE: raw building→queued demote, no marker",
    file: "supabase/functions/bad-producer/index.ts",
    code: `
export async function bad(sb: any, id: string) {
  await sb.from("course_packages").update({
    status: "queued",
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("status", "building");
}
`,
    expectViolation: true,
  },
  {
    name: "SAFE: fn_package_demote_protected gate above",
    file: "supabase/functions/good-gated/index.ts",
    code: `
export async function safe(sb: any, id: string) {
  const { data: prot } = await sb.rpc("fn_package_demote_protected", { p_package_id: id });
  if (prot && prot.protected) return;
  await sb.from("course_packages").update({
    status: "queued",
  }).eq("id", id).eq("status", "building");
}
`,
    expectViolation: false,
  },
  {
    name: "SAFE: SAFE_PACKAGE_STATUS_DEMOTE allowlist comment",
    file: "supabase/functions/good-allowlisted/index.ts",
    code: `
export async function safe2(sb: any, id: string) {
  // SAFE_PACKAGE_STATUS_DEMOTE: planning→queued is the canonical initial enqueue.
  await sb.from("course_packages").update({ status: "queued" })
    .eq("id", id).eq("status", "planning");
}
`,
    expectViolation: false,
  },
  {
    name: "SAFE: admin_force_publish marker context",
    file: "supabase/functions/good-force-publish/index.ts",
    code: `
// admin_force_publish wrapper
export async function fp(sb: any, id: string) {
  await sb.from("course_packages").update({ status: "queued" }).eq("id", id);
}
`,
    expectViolation: false,
  },
  {
    name: "SAFE: status:'queued' on package_steps (sibling table) — must NOT trip on course_packages",
    file: "supabase/functions/sibling-steps/index.ts",
    code: `
export async function steps(sb: any, id: string) {
  await sb.from("package_steps").update({ status: "queued" }).eq("package_id", id);
  await sb.from("course_packages").update({ updated_at: new Date().toISOString() }).eq("id", id);
}
`,
    expectViolation: false,
  },
  {
    name: "UNSAFE: marker exists but >25 lines away (out of window)",
    file: "supabase/functions/bad-far-marker/index.ts",
    code: `
// fn_package_demote_protected mention way up here
${Array.from({ length: 30 }, (_, i) => `// padding line ${i}`).join("\n")}
export async function farMarker(sb: any, id: string) {
  await sb.from("course_packages").update({ status: "queued" }).eq("id", id).eq("status", "building");
}
`,
    expectViolation: true,
  },
];

let pass = 0, fail = 0;
const results = [];

for (const c of CASES) {
  const dir = mkdtempSync(join(tmpdir(), "guardtest-"));
  try {
    // Mirror minimal repo layout the guard expects
    const fileFull = join(dir, c.file);
    mkdirSync(join(fileFull, ".."), { recursive: true });
    writeFileSync(fileFull, c.code);
    // Copy guard into the temp repo so its relative ROOTS are scanned there
    mkdirSync(join(dir, "scripts/guards"), { recursive: true });
    cpSync(guardSrc, join(dir, "scripts/guards/guard-package-status-demotes.mjs"));

    let violated = false;
    let stdout = "", stderr = "";
    try {
      stdout = execFileSync("node", ["scripts/guards/guard-package-status-demotes.mjs"], {
        cwd: dir, encoding: "utf8",
      });
    } catch (e) {
      violated = true;
      stdout = e.stdout?.toString() ?? "";
      stderr = e.stderr?.toString() ?? "";
    }

    const ok = violated === c.expectViolation;
    if (ok) pass++; else fail++;
    results.push({ name: c.name, expected: c.expectViolation, got: violated, ok, stderr: stderr.slice(0, 200) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n=== guard-package-status-demotes integration test ===\n");
for (const r of results) {
  const tag = r.ok ? "✅" : "❌";
  console.log(`${tag} ${r.name}`);
  console.log(`     expected violation=${r.expected}  got=${r.got}`);
  if (!r.ok && r.stderr) console.log(`     stderr: ${r.stderr}`);
}
console.log(`\n${pass}/${pass + fail} passed`);

process.exit(fail === 0 ? 0 : 1);
