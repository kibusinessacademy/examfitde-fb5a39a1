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
  {
    id: "R9_select_into_missing_projection",
    desc: "SELECT INTO benötigt Projektion (z.B. SELECT * INTO v_row FROM ...).",
    test: (s) => {
      const m = [...s.matchAll(/\bSELECT\s+INTO\s+[a-z_][a-z0-9_]*\s+FROM\b/gi)];
      return m.length ? m.map((x) => `SELECT INTO without projection near offset ${x.index}`) : null;
    },
  },
  {
    id: "R10_unknown_status_literals",
    desc: "Verdächtige freie Status-Literale erkannt (job_queue/package_steps Status-Enum).",
    severity: "warn",
    test: (s) => {
      const allowed = new Set([
        "queued","pending","processing","done","failed","cancelled",
        "skipped","retry_scheduled","blocked","building","draft","published",
        "review_required","approved","rejected","active","inactive","paid",
        "refunded","completed","ready","running","success","error","unknown",
        "deferred","claimed",
      ]);
      const re = /\bstatus\s*(?:=|<>|!=)\s*'([^']+)'/gi;
      const violations = [];
      let m;
      while ((m = re.exec(s))) {
        if (!allowed.has(m[1].toLowerCase())) {
          violations.push(`unknown status literal '${m[1]}' near offset ${m.index}`);
        }
      }
      return violations.length ? violations : null;
    },
  },
  {
    id: "R11_trigger_updates_same_table",
    desc: "Trigger-Funktion enthält UPDATE — Rekursionsrisiko, manuelles Review nötig (warn).",
    severity: "warn",
    test: (s) => {
      const violations = [];
      const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)[\s\S]*?RETURNS\s+TRIGGER[\s\S]*?\$\$([\s\S]*?)\$\$/gi;
      let m;
      while ((m = re.exec(s))) {
        const fn = m[1];
        const body = m[2];
        const upd = [...body.matchAll(/\bUPDATE\s+([a-z_][\w.]*)/gi)];
        for (const u of upd) {
          violations.push(`trigger function ${fn} updates table ${u[1]} — recursion review required`);
        }
      }
      return violations.length ? violations : null;
    },
  },
  {
    id: "R12_session_replication_role",
    desc: "session_replication_role darf nur in expliziten manuellen Heals verwendet werden (warn).",
    severity: "warn",
    test: (s) =>
      /session_replication_role/i.test(s)
        ? ["session_replication_role usage requires manual review"]
        : null,
  },
  {
    id: "R13_security_definer_without_auth_guard",
    desc: "SECURITY DEFINER Funktion ohne has_role/auth.uid Guard (warn — viele interne Helper).",
    severity: "warn",
    test: (s) => {
      const violations = [];
      const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)[\s\S]*?SECURITY\s+DEFINER[\s\S]*?\$\$([\s\S]*?)\$\$/gi;
      let m;
      while ((m = re.exec(s))) {
        const fn = m[1];
        const body = m[2];
        // Internal/system functions exempted: triggers, fn_*, _internal_*, validators
        if (/RETURNS\s+TRIGGER/i.test(m[0])) continue;
        if (!/has_role\s*\(/i.test(body) && !/auth\.uid\s*\(/i.test(body) && !/is_e2e_smoke_user\s*\(/i.test(body)) {
          violations.push(`${fn} missing auth guard (has_role/auth.uid)`);
        }
      }
      return violations.length ? violations : null;
    },
  },
  {
    id: "R14_rpc_contract_drift",
    desc: "supabase.rpc('xyz') wird gegen vorhandene CREATE FUNCTION Definitionen geprüft (warn).",
    severity: "warn",
    test: () => null, // Cross-file check — handled separately in main()
  },
  {
    // Markdown-rendering eats `*` in chat copy-paste. Detect leftover patterns.
    id: "R15_markdown_stripped_multiply",
    desc: "Markdown-Rendering hat vermutlich '*' geschluckt — z.B. '100.0  field', 'numeric  100', 'a)  b'. Bitte explizit '*' setzen.",
    test: (s) => {
      const violations = [];
      // Pattern A: number  identifier  (e.g. "100.0  hb_published")
      const reA = /\b\d+(?:\.\d+)?  +[a-z_][a-z0-9_.]*\b/gi;
      // Pattern B: ::numeric  number   or   identifier::numeric  100
      const reB = /::numeric  +\d/gi;
      // Pattern C: closing-paren  number/identifier (e.g. ")  100")
      const reC = /\)  +(?:\d+(?:\.\d+)?|[a-z_][a-z0-9_]*)\b/gi;
      for (const re of [reA, reB, reC]) {
        for (const m of s.matchAll(re)) {
          violations.push(`possibly stripped '*' near offset ${m.index}: "${m[0].trim()}"`);
        }
      }
      return violations.length ? violations : null;
    },
  },
  {
    id: "R16_count_alias_empty",
    desc: "COUNT(alias.) ohne Spalte verboten — Markdown-Rendering hat '*' verschluckt. Nutze COUNT(alias.id) oder COUNT(*).",
    test: (s) => {
      const m = [...s.matchAll(/\bcount\s*\(\s*[a-z_][a-z0-9_]*\.\s*\)/gi)];
      return m.length ? m.map((x) => `bad COUNT near offset ${x.index}: "${x[0]}"`) : null;
    },
  },
  {
    id: "R17_drop_view_dependency_hint",
    desc: "DROP VIEW erkannt — Pre-Deploy pg_depend-Check empfohlen (warn).",
    severity: "warn",
    test: (s) => {
      const violations = [];
      const re = /\bDROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?([\w.]+)/gi;
      let m;
      while ((m = re.exec(s))) {
        // Skip if a 'CREATE VIEW <same>' follows in same file (pure replace)
        const tail = s.slice(m.index);
        const sameRecreate = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+${m[1].replace(/\./g, "\\.")}\\b`, "i");
        if (sameRecreate.test(tail)) continue;
        violations.push(`DROP VIEW ${m[1]} without same-file CREATE — verify pg_depend has no dependents`);
      }
      return violations.length ? violations : null;
    },
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
//
// Modes:
//   - default:  Apply ALL migrations in chronological order (filename sort)
//               so dependency errors surface even when only a late file
//               changed. Each migration is committed (not rolled back) so
//               later ones see prior schema.
//   - per-file: When SHADOW_PER_FILE_ROLLBACK=1, each file is wrapped in
//               BEGIN/ROLLBACK independently (legacy behavior).
//
async function runShadowReplay(changedFiles) {
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

  const perFileRollback = process.env.SHADOW_PER_FILE_ROLLBACK === "1";
  const all = listAllMigrations().sort(); // filename = timestamp prefix
  const changedSet = new Set(changedFiles.map((f) => resolve(f)));

  // Determine target: latest changed file, or last of all if none changed
  const lastChangedIdx = all.reduce(
    (acc, f, i) => (changedSet.has(resolve(f)) ? i : acc),
    -1,
  );
  const targetIdx = lastChangedIdx >= 0 ? lastChangedIdx : all.length - 1;
  const sequence = all.slice(0, targetIdx + 1);

  console.log(
    `\n🌑 Shadow replay: applying ${sequence.length} migrations in order ` +
      `(target = ${sequence[sequence.length - 1]?.replace(ROOT + "/", "")}, ` +
      `mode = ${perFileRollback ? "per-file rollback" : "cumulative replay"})`,
  );

  try {
    await client.connect();
    let appliedCount = 0;
    for (const f of sequence) {
      const sql = readFileSync(f, "utf8");
      const rel = f.replace(ROOT + "/", "");
      const isChanged = changedSet.has(resolve(f));
      const tag = isChanged ? "🟡 CHANGED" : "  prior  ";
      try {
        if (perFileRollback) {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("ROLLBACK");
        } else {
          await client.query(sql);
        }
        appliedCount++;
        if (isChanged || appliedCount % 25 === 0 || f === sequence[sequence.length - 1]) {
          console.log(`  ${tag}  ${rel}`);
        }
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`  ✖ shadow exec failed on ${rel}: ${err.message}`);
        return { ran: true, ok: false, error: err.message, file: rel };
      }
    }
    // Generic post-replay smoke
    await client.query("SELECT 1");
    return { ran: true, ok: true, applied: appliedCount };
  } finally {
    await client.end().catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────────────
// RPC contract drift — cross-file scan
// ──────────────────────────────────────────────────────────────────────────
function rpcContractCheck() {
  const violations = [];
  // Collect defined functions from all migrations
  const defined = new Set();
  for (const f of listAllMigrations()) {
    const sql = stripCommentsAndStrings(readFileSync(f, "utf8"));
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][\w]*)\s*\(/gi;
    let m;
    while ((m = re.exec(sql))) defined.add(m[1].toLowerCase());
  }
  // Scan src/ and supabase/functions/ for supabase.rpc('name')
  const callers = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (/node_modules|\.git|dist|build/.test(entry)) continue;
        walk(p);
      } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
        const txt = readFileSync(p, "utf8");
        const re = /\.rpc\s*\(\s*['"`]([a-z_][\w]*)['"`]/gi;
        let m;
        while ((m = re.exec(txt))) callers.push({ name: m[1].toLowerCase(), file: p });
      }
    }
  };
  walk(resolve(ROOT, "src"));
  walk(resolve(ROOT, "supabase/functions"));

  const missing = new Map();
  for (const c of callers) {
    if (!defined.has(c.name)) {
      const arr = missing.get(c.name) ?? [];
      arr.push(c.file.replace(ROOT + "/", ""));
      missing.set(c.name, arr);
    }
  }
  for (const [name, files] of missing) {
    violations.push(`rpc('${name}') called but no CREATE FUNCTION found — files: ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` (+${files.length - 3})` : ""}`);
  }
  return violations;
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

  let hardViolations = 0;
  let warnViolations = 0;
  for (const f of files) {
    const findings = lintFile(f);
    const rel = f.replace(ROOT + "/", "");
    if (!findings.length) {
      console.log(`✓ ${rel}`);
      continue;
    }
    console.log(`✖ ${rel}`);
    for (const v of findings) {
      const rule = RULES.find((r) => r.id === v.rule);
      const isWarn = rule?.severity === "warn";
      if (isWarn) warnViolations += v.hits.length;
      else hardViolations += v.hits.length;
      console.log(`   • [${v.rule}${isWarn ? " WARN" : ""}] ${v.desc}`);
      for (const h of v.hits.slice(0, 5)) console.log(`       - ${h}`);
    }
  }

  // Cross-file RPC contract drift (warn only)
  const rpcDrift = rpcContractCheck();
  if (rpcDrift.length) {
    console.log(`\n⚠ R14_rpc_contract_drift WARN — ${rpcDrift.length} caller(s) without matching FUNCTION:`);
    for (const r of rpcDrift.slice(0, 20)) console.log(`   - ${r}`);
    warnViolations += rpcDrift.length;
  }

  if (hardViolations > 0) {
    console.log(`\n${hardViolations} hard violation(s), ${warnViolations} warn — blocking merge.`);
    console.log("See mem://constraints/migration-discipline-v1 for the full ruleset.");
    process.exit(1);
  }
  if (warnViolations > 0) {
    console.log(`\n✓ No hard violations. ${warnViolations} warning(s) — review recommended.`);
  } else {
    console.log("\n✓ All static guardrails passed.\n");
  }

  const smoke = await runShadowReplay(files);
  if (smoke.ran && !smoke.ok) {
    console.log(`\n✖ Shadow DB replay failure on ${smoke.file}: ${smoke.error}`);
    process.exit(2);
  }
  if (smoke.ran) console.log(`✓ Shadow replay passed (${smoke.applied} migrations applied).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Guard crashed:", e);
  process.exit(3);
});
