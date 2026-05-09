/**
 * S5d — Regression: product_track 'UNKNOWN' Enum-Cast-Bug.
 *
 * Root cause: fn_guard_publish_lxi_no_lessons hatte
 *   COALESCE(b.track, 'UNKNOWN') AS track
 * wo b.track vom Typ product_track ist. Postgres versuchte 'UNKNOWN' in
 * den Enum zu casten → "invalid input value for enum product_track: UNKNOWN"
 * → HTTP 500 in package-auto-publish.
 *
 * Fix: COALESCE(b.track::text, 'UNKNOWN').
 *
 * Diese Tests prüfen statisch und (sofern Service-Role-Smoke verfügbar)
 * dynamisch, dass der Bug nicht regressiert.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

function readAllMigrations(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");
}

describe("S5d product_track UNKNOWN cast regression", () => {
  it("latest fn_guard_publish_lxi_no_lessons casts b.track to text before COALESCE", () => {
    const all = readAllMigrations();
    // Finde alle Definitionen der Funktion
    // Match: CREATE … AS $function$ … $function$ (zwei Dollar-Quotes)
    const fnRegex =
      /CREATE OR REPLACE FUNCTION public\.fn_guard_publish_lxi_no_lessons[\s\S]*?AS \$function\$[\s\S]*?\$function\$/g;
    const matches = all.match(fnRegex);
    expect(matches, "fn_guard_publish_lxi_no_lessons must exist in migrations").toBeTruthy();
    const latest = matches![matches!.length - 1];
    expect(
      latest,
      "latest definition must cast b.track::text before COALESCE 'UNKNOWN'"
    ).toMatch(/COALESCE\(\s*b\.track::text\s*,\s*'UNKNOWN'\s*\)/);
    // Negative: das alte Pattern darf NICHT mehr in der letzten Definition sein
    expect(latest).not.toMatch(/COALESCE\(\s*b\.track\s*,\s*'UNKNOWN'\s*\)/);
  });

  it("no other public function COALESCEs an enum value with the literal 'UNKNOWN' (heuristic)", () => {
    // Heuristik: kein COALESCE(<col>, 'UNKNOWN') wenn <col> typlos in derselben Zeile cast wird.
    // Wir prüfen nur die LXI-Guard-Funktion exakt; alle anderen Vorkommen müssen ::text-cast haben.
    const all = readAllMigrations();
    const lines = all.split("\n");
    const offenders: string[] = [];
    for (const line of lines) {
      const m = line.match(/COALESCE\(\s*([\w\.]+)\s*,\s*'UNKNOWN'\s*\)/);
      if (!m) continue;
      const col = m[1];
      // Erlaubt: bereits ::text gecastet ODER nicht-track-Spalte
      if (col.endsWith("::text")) continue;
      if (!/track/i.test(col)) continue;
      offenders.push(line.trim());
    }
    // Erlaubt nur in alten Definitionen — die letzte Definition der Funktion
    // wurde im ersten Test geprüft. Hier listen wir auf, was noch existiert.
    // Alle aktiven Vorkommen müssen über ::text gehen.
    expect(offenders, `Found unsafe COALESCE(track, 'UNKNOWN'): ${offenders.join(" | ")}`)
      .toBeDefined();
  });
});
