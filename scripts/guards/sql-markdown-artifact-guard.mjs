#!/usr/bin/env node
/**
 * SQL Markdown-Artifact Guard
 * --------------------------------------------------------------
 * Verhindert, dass Copy-Paste-Schäden aus Markdown/Chat in echte
 * Migrationen leaken. Erkennt verschwundene `*`, weggebrochene
 * Spalten oder fehlerhafte COUNT()-Ausdrücke.
 *
 * Hard-Block-Pattern (in supabase/migrations/**.sql):
 *   - bare COUNT()                 → muss COUNT(*) / COUNT(expr) sein
 *   - COUNT(<alias>.)              → fehlende Spalte
 *   - SELECT FROM                  → fehlende Projektion (kein '*' / Spalten)
 *   - SELECT  FROM                 → desgleichen mit Doppelspace
 *   - 100.0  <ident>               → fehlendes '*' bei Multiplikation
 *   - ::numeric  100               → desgleichen
 *   - / numeric  100               → desgleichen
 *
 * Bewusst NICHT gematcht (false-positive-frei):
 *   - `SELECT c.*`, `SELECT g.*` (CTE-Star)
 *   - `SELECT col FROM ...`
 *   - `SELECT 1 FROM ...`
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const DIR = "supabase/migrations";

const PATTERNS = [
  { name: "bare COUNT()",            re: /\bCOUNT\s*\(\s*\)/i,            hint: "Use COUNT(*) or COUNT(expr)." },
  { name: "COUNT(alias.)",           re: /\bCOUNT\s*\(\s*[a-z_][a-z0-9_]*\s*\.\s*\)/i, hint: "Missing column name in COUNT(alias.<col>)." },
  { name: "SELECT FROM (no proj.)",  re: /\bSELECT\s+FROM\b/i,             hint: "Missing projection between SELECT and FROM." },
  { name: "100.0 <ident> (no '*')",  re: /\b100\.0\s{2,}[a-z_][a-z0-9_]*/i, hint: "Likely missing '*' before identifier (e.g. 100.0 * field)." },
  { name: "::numeric 100 (no '*')",  re: /::numeric\s{2,}100\b/i,           hint: "Likely missing '*' before 100." },
  { name: "/ numeric  100 (no '*')", re: /\/\s*numeric\s{2,}100\b/i,        hint: "Likely missing '*' before 100." },
];

function stripComments(sql) {
  // Remove -- line comments and /* ... */ blocks so we don't false-positive on docs.
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

function changedFiles() {
  const env = process.env.CHANGED_MIGRATION_FILES;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR).filter((f) => f.endsWith(".sql")).map((f) => join(DIR, f));
}

function main() {
  const files = changedFiles();
  if (!files.length) {
    console.log("ℹ️  No migrations to scan.");
    process.exit(0);
  }

  let failures = 0;
  for (const file of files) {
    const path = file.includes("/") ? file : join(DIR, file);
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf-8");
    const sql = stripComments(raw);
    const lines = sql.split("\n");

    lines.forEach((line, idx) => {
      // skip allow marker
      if (line.includes("lovable-sql-allow")) return;
      for (const p of PATTERNS) {
        if (p.re.test(line)) {
          console.error(`❌ ${path}:${idx + 1}  [${p.name}]`);
          console.error(`   > ${line.trim()}`);
          console.error(`   hint: ${p.hint}`);
          failures++;
        }
      }
    });
  }

  if (failures > 0) {
    console.error(`\n🚫 SQL Markdown-Artifact Guard FAILED — ${failures} hit(s).`);
    process.exit(1);
  }
  console.log(`✅ SQL Markdown-Artifact Guard clean (${files.length} file(s) scanned).`);
}

main();
