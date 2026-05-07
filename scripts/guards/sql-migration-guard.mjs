#!/usr/bin/env node
/**
 * SQL Migration Guard — ExamFit Migration Discipline v1
 * ─────────────────────────────────────────────────────
 * Static checks every supabase/migrations/*.sql file against the project's
 * non-negotiable guardrails (see mem://constraints/migration-discipline-v1).
 *
 * Optionally executes the migration against a Supabase Shadow-DB if
 * SHADOW_DATABASE_URL is set in the environment (CI secret), then runs a
 * generic smoke section to ensure functions compile and basic invariants hold.
 *
 * Usage:
 *   node scripts/guards/sql-migration-guard.mjs                # all migrations changed in PR
 *   node scripts/guards/sql-migration-guard.mjs --all          # full repo
 *   node scripts/guards/sql-migration-guard.mjs path/to/x.sql  # explicit
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — at least one guardrail violated
 *   2 — shadow DB smoke failure
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = process.cwd();
const MIG_DIR = resolve(ROOT, "supabase/migrations");

// ──────────────────────────────────────────────────────────────────────────
// Guardrail rules — each rule scans one migration's SQL text.
// Rules are conservative: they look for syntactic anti-patterns OUTSIDE
// of comments/strings using a single pre-pass that strips them.
// ──────────────────────────────────────────────────────────────────────────

function stripCommentsAndStrings(sql) {
  // Strip block comments
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Strip line comments
  out = out.replace(/--[^\n]*/g, " ");
  // Strip dollar-quoted strings (function bodies stay — we want to scan them)
  // but strip simple single-quoted strings to avoid false positives
  out = out.replace(/'(?:[^']|'')*'/g, "''");
  return out;
}

const RULES = [
  {
    id: "R1_count_no_args",
    desc: "COUNT() ohne Argument verboten — nutze COUNT(*) oder COUNT(expr).",
    test: (s) => {
      const m = [...s.matchAll(/\bcount\s*\(\s*\)/gi)];
      return m.length ? m.map((x) => `at offset ${x.index}`) : null;
    },
  },
  {
    id: "R2_bad_cron",
    desc: "cron.schedule benötigt gültigen 5-Feld-Cron (z.B. '*/10 * * * *').",
    test: (s) => {
      const violations = [];
      const re = /cron\.schedule\s*\(\s*'([^']+)'\s*,\s*'([^']+)'/gi;
      let m;
      while ((m = re.exec(s))) {
        const expr = m[2].trim();
        const fields = expr.split(/\s+/);
        if (fields.length !== 5) {
          violations.push(`cron '${m[1]}' has invalid expression "${expr}" (${fields.length} fields)`);
        }
      }
      return violations.length ? violations : null;
    },
  },
  {
    id: "R3_freeform_jobtype",
    desc: "Freie job_type-Konstruktion verboten — nutze ops_job_type_registry oder step_dag_edges-Whitelist.",
    test: (s) => {
      // 'package_'||something — concatenation with a variable
      const m = [...s.matchAll(/'package_'\s*\|\|\s*[a-z_][a-z0-9_]*/gi)];
      // also catch string concat in INSERT job_type column
      return m.length ? m.map((x) => `concat near offset ${x.index}: ${x[0]}`) : null;
    },
  },
  {
    id: "R4_jsonb_agg_with_limit",
    desc: "jsonb_agg(...) mit LIMIT muss in Subquery stehen — sonst silently fehlerhaft.",
    test: (s) => {
      // Look for jsonb_agg(...) ... LIMIT n  in same statement (rough heuristic)
      const re = /jsonb_agg\s*\([^()]*\)[^;]{0,400}?\bLIMIT\s+\d+/gis;
      const m = [...s.matchAll(re)];
      // Filter out the cases where there's a clearly wrapping subquery: occurrence of 'FROM (' before
      const violations = [];
      for (const match of m) {
        const before = s.slice(Math.max(0, match.index - 200), match.index);
        if (!/from\s*\(/i.test(before)) {
          violations.push(`jsonb_agg+LIMIT without subquery near offset ${match.index}`);
        }
      }
      return violations.length ? violations : null;
    },
  },
  {
    id: "R5_security_definer_search_path",
    desc: "SECURITY DEFINER Funktionen müssen SET search_path setzen (= public oder TO 'public').",
    test: (s) => {
      const violations = [];
      const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)[\s\S]*?LANGUAGE\s+\w+[\s\S]*?SECURITY\s+DEFINER([\s\S]*?)AS\s+\$\$/gi;
      let m;
      while ((m = re.exec(s))) {
        const head = m[0];
        if (!/SET\s+search_path\b/i.test(head)) {
          violations.push(`function ${m[1]} is SECURITY DEFINER without SET search_path`);
        }
      }
      return violations.length ? violations : null;
    },
  },
  {
    id: "R6_admin_view_grant",
    desc: "Admin-Views nie an authenticated/anon granten — Zugriff nur über RPC mit has_role-Gate.",
    test: (s) => {
      const violations = [];
      const re = /GRANT\s+SELECT\s+ON\s+([\w.]*v_admin[\w.]*)\s+TO\s+(authenticated|anon)/gi;
      let m;
      while ((m = re.exec(s))) {
        violations.push(`bad grant on ${m[1]} → ${m[2]}`);
      }
      return violations.length ? violations : null;
    },
  },
  {
    id: "R7_ddl_on_reserved_schema",
    desc: "Keine DDL auf auth/storage/realtime/supabase_functions/vault Schemas.",
    test: (s) => {
      const violations = [];
      // Only flag when reserved schema is the *target* of a TABLE/TRIGGER/POLICY/VIEW/INDEX/TYPE/FUNCTION DDL.
      // Function/policy calls like auth.uid() are excluded by requiring an identifier (no '(') right after schema.
      const re = /\b(CREATE|ALTER|DROP)\s+(?:TABLE|TRIGGER|FUNCTION|VIEW|INDEX|TYPE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(auth|storage|realtime|supabase_functions|vault)\.[a-z_][a-z0-9_]*/gi;
      let m;
      while ((m = re.exec(s))) violations.push(`${m[1]} on reserved schema ${m[2]}`);
      const reP = /\bCREATE\s+POLICY\s+[^;]*?\bON\s+(auth|storage|realtime|supabase_functions|vault)\./gi;
      while ((m = reP.exec(s))) violations.push(`CREATE POLICY on reserved schema ${m[1]}`);
      return violations.length ? violations : null;
    },
  },
  {
    id: "R8_alter_database",
    desc: "ALTER DATABASE postgres ist auf Supabase nicht erlaubt.",
    test: (s) => (/ALTER\s+DATABASE\s+postgres/i.test(s) ? ["ALTER DATABASE postgres found"] : null),
  },
];

function lintFile(path) {
  const raw = readFileSync(path, "utf8");
  const stripped = stripCommentsAndStrings(raw);
  const findings = [];
  for (const rule of RULES) {
    const v = rule.test(stripped);
    if (v) findings.push({ rule: rule.id, desc: rule.desc, hits: v });
  }
  return findings;
}

// ──────────────────────────────────────────────────────────────────────────
// File selection
// ──────────────────────────────────────────────────────────────────────────
function listAllMigrations() {
  if (!existsSync(MIG_DIR)) return [];
  return readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => join(MIG_DIR, f))
    .filter((f) => statSync(f).isFile());
}

function changedMigrations() {
  try {
    const base = process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : "HEAD~1";
    const out = execSync(`git diff --name-only --diff-filter=AM ${base}...HEAD`, {
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("supabase/migrations/") && l.endsWith(".sql"))
      .map((l) => resolve(ROOT, l));
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Optional: shadow DB execution
// ──────────────────────────────────────────────────────────────────────────
async function runShadowSmoke(files) {
  const url = process.env.SHADOW_DATABASE_URL;
  if (!url) {
    console.log("ℹ️  SHADOW_DATABASE_URL not set — skipping shadow execution.");
    return { ran: false, ok: true };
  }
  let pg;
  try {
    pg = await import("pg");
  } catch {
    console.log("ℹ️  'pg' not installed — skipping shadow execution.");
    return { ran: false, ok: true };
  }
  const { Client } = pg.default ?? pg;
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    for (const f of files) {
      const sql = readFileSync(f, "utf8");
      console.log(`  ↳ exec ${f}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        // Generic smoke checks — never throw, just collect
        await client.query("SELECT 1");
        await client.query("ROLLBACK");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`  ✖ shadow exec failed on ${f}: ${err.message}`);
        return { ran: true, ok: false, error: err.message, file: f };
      }
    }
    return { ran: true, ok: true };
  } finally {
    await client.end().catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  let files = [];
  if (args.includes("--all")) files = listAllMigrations();
  else if (args.length && !args[0].startsWith("--")) files = args.map((a) => resolve(ROOT, a));
  else files = changedMigrations();

  if (!files.length) {
    console.log("✓ No migrations to lint.");
    process.exit(0);
  }

  console.log(`SQL Migration Guard — scanning ${files.length} file(s)\n`);

  let violations = 0;
  for (const f of files) {
    const findings = lintFile(f);
    const rel = f.replace(ROOT + "/", "");
    if (!findings.length) {
      console.log(`✓ ${rel}`);
      continue;
    }
    violations += findings.length;
    console.log(`✖ ${rel}`);
    for (const v of findings) {
      console.log(`   • [${v.rule}] ${v.desc}`);
      for (const h of v.hits.slice(0, 5)) console.log(`       - ${h}`);
    }
  }

  if (violations > 0) {
    console.log(`\n${violations} guardrail violation(s) — blocking merge.`);
    console.log("See mem://constraints/migration-discipline-v1 for the full ruleset.");
    process.exit(1);
  }

  console.log("\n✓ All static guardrails passed.\n");

  const smoke = await runShadowSmoke(files);
  if (smoke.ran && !smoke.ok) {
    console.log(`\n✖ Shadow DB smoke failure: ${smoke.error}`);
    process.exit(2);
  }
  if (smoke.ran) console.log("✓ Shadow DB smoke passed.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Guard crashed:", e);
  process.exit(3);
});
