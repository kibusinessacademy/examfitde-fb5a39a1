#!/usr/bin/env node
/**
 * SQL-Discipline Guard (Hard-Block)
 * --------------------------------------------------------------
 * Erzwingt ExamFit System Rules v1 für SQL-Disziplin.
 * Doku: docs/SYSTEM_RULES.md
 * Memory: mem://architektur/ops/system-rules-v1
 *
 * Verbotene Muster (Hard-Fail bei Treffer):
 *   1. COUNT()                            → muss COUNT(*) sein
 *   2. SELECT INTO ohne *                 → muss SELECT * INTO sein
 *   3. RETURNING INTO ohne *              → muss RETURNING * INTO sein
 *   4. SECURITY DEFINER ohne REVOKE       → Privilege-Eskalation
 *   5. GRANT ... TO authenticated         → auf v_admin_* / admin_* Views/Functions
 *
 * Scope:
 *   - supabase/migrations/**.sql
 *   - supabase/functions/**\/*.{ts,sql}
 *   - src/**\/*.{ts,tsx} (nur SQL-String-Literale via simpler Heuristik)
 *
 * Allowlist: Zeilen mit Kommentar `-- lovable-sql-allow:<reason>` werden ignoriert.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
const SCAN = [
  { dir: "supabase/migrations", exts: [".sql"] },
  { dir: "supabase/functions",  exts: [".sql", ".ts"] },
  { dir: "src",                 exts: [".ts", ".tsx"] },
];
const SKIP = new Set([
  "node_modules", ".git", "dist", "build", ".lovable",
  "test", "tests", "__tests__", "e2e",
]);

const ALLOW_MARKER = /lovable-sql-allow/i;

/**
 * Pattern-Definitionen.
 * `pattern` ist Regex, `name` Kurzname, `hint` Erklärung.
 * Pattern werden zeilenweise geprüft — Multi-Line via Block-Aggregation.
 */
const PATTERNS = [
  {
    name: "COUNT_NO_STAR",
    // COUNT(  )  — leere Klammern (mit beliebigem Whitespace)
    pattern: /\bCOUNT\s*\(\s*\)/i,
    hint: "COUNT() ist ungültig. Verwende COUNT(*).",
  },
  {
    name: "SELECT_INTO_NO_STAR",
    // SELECT  INTO v_var FROM ...   (kein * vor INTO)
    // matched: SELECT INTO ..., SELECT  \n  INTO ...
    // erlaubt: SELECT *, SELECT col, col2, SELECT col INTO
    // Heuristik: "SELECT" + whitespace + "INTO" direkt (ohne dazwischenliegende Tokens)
    pattern: /\bSELECT\s+INTO\b/i,
    hint: "SELECT INTO ohne Spaltenliste/Stern ist invalid. Verwende: SELECT * INTO v_row FROM ...",
  },
  {
    name: "RETURNING_INTO_NO_STAR",
    // RETURNING INTO v_var  (ohne * oder Spaltenliste)
    pattern: /\bRETURNING\s+INTO\b/i,
    hint: "RETURNING INTO ohne Spalten ist invalid. Verwende: RETURNING * INTO v_row.",
  },
  {
    name: "GRANT_AUTHENTICATED_ON_ADMIN",
    // GRANT ... ON (v_admin_* | admin_*) TO authenticated
    pattern: /GRANT\s+(SELECT|EXECUTE|ALL)[^;]*\b(v_admin_|admin_)[a-z0-9_]+[^;]*\bTO\s+authenticated\b/i,
    hint: "Admin-Views/Functions dürfen NICHT direkt an 'authenticated' freigegeben werden. RPC-Wrapper mit has_role('admin').",
  },
];

/**
 * Multi-File Pattern: SECURITY DEFINER ohne REVOKE im selben File.
 * Wird separat geprüft (nicht line-by-line).
 */
function checkSecurityDefinerHygiene(file, content) {
  const violations = [];
  // Find SECURITY DEFINER function definitions
  const defRegex = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z0-9_.]+)\s*\([^)]*\)[\s\S]*?SECURITY\s+DEFINER/gi;
  let m;
  while ((m = defRegex.exec(content)) !== null) {
    const fnName = m[2];
    const fnBare = fnName.split(".").pop();
    // muss REVOKE ... FROM PUBLIC ODER GRANT ... TO service_role im selben File haben
    const hasRevoke = new RegExp(`REVOKE\\s+[^;]*\\bON\\s+FUNCTION\\s+${fnName.replace(/\./g, "\\.")}|REVOKE\\s+[^;]*${fnBare}`, "i").test(content);
    const hasServiceRoleGrant = new RegExp(`GRANT\\s+EXECUTE[^;]*${fnBare}[^;]*TO\\s+service_role`, "i").test(content);
    if (!hasRevoke && !hasServiceRoleGrant) {
      violations.push({
        name: "SECURITY_DEFINER_NO_REVOKE",
        line: content.slice(0, m.index).split("\n").length,
        snippet: `CREATE FUNCTION ${fnName} ... SECURITY DEFINER`,
        hint: `SECURITY DEFINER auf ${fnName} ohne REVOKE FROM PUBLIC + GRANT EXECUTE TO service_role. Privilege-Eskalation möglich.`,
      });
    }
  }
  return violations;
}

function* walk(dir, exts) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const full = join(dir, e);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) yield* walk(full, exts);
    else if (exts.includes(extname(e))) yield full;
  }
}

function checkLines(file, content) {
  const violations = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ALLOW_MARKER.test(line)) continue;
    // SQL-Kommentare überspringen
    const stripped = line.replace(/--.*$/, "");
    for (const p of PATTERNS) {
      if (p.pattern.test(stripped)) {
        violations.push({
          name: p.name,
          line: i + 1,
          snippet: line.trim().slice(0, 160),
          hint: p.hint,
        });
      }
    }
  }
  // Multi-line: SECURITY DEFINER hygiene
  if (file.endsWith(".sql")) {
    violations.push(...checkSecurityDefinerHygiene(file, content));
  }
  return violations;
}

function main() {
  const allViolations = [];
  let scanned = 0;

  for (const { dir, exts } of SCAN) {
    const abs = join(ROOT, dir);
    for (const file of walk(abs, exts)) {
      // Skip Self
      if (file.endsWith("sql-discipline-guard.mjs")) continue;
      scanned++;
      let content;
      try { content = readFileSync(file, "utf8"); } catch { continue; }
      const v = checkLines(file, content);
      if (v.length) {
        allViolations.push({ file: relative(ROOT, file), violations: v });
      }
    }
  }

  if (allViolations.length === 0) {
    console.log(`✅ SQL-Discipline Guard: ${scanned} files scanned, 0 violations.`);
    process.exit(0);
  }

  console.error("\n❌ SQL-Discipline Guard: VERSTÖSSE GEFUNDEN\n");
  console.error("Doku: docs/SYSTEM_RULES.md  |  Memory: mem://architektur/ops/system-rules-v1\n");
  let total = 0;
  for (const f of allViolations) {
    console.error(`📄 ${f.file}`);
    for (const v of f.violations) {
      total++;
      console.error(`   L${v.line}  [${v.name}]  ${v.snippet}`);
      console.error(`        → ${v.hint}`);
    }
    console.error("");
  }
  console.error(`Summary: ${total} violation(s) across ${allViolations.length} file(s). ${scanned} files scanned.`);
  console.error(`\nFix oder explizit allowlisten via Kommentar: -- lovable-sql-allow:<reason>`);
  process.exit(1);
}

main();
