/**
 * Access-RPC Response-Shape Snapshot
 * ----------------------------------
 * Friert die *Vertragsstruktur* (Felder + erlaubte reason-Codes) der
 * Access-SSOT-RPCs ein. Wenn jemand:
 *   - ein Feld umbenennt (allowed → granted)
 *   - einen neuen reason-Code einführt (z.B. `no_entitlement` reanimiert
 *     in einem RPC, der ihn nicht hatte)
 *   - oder einen Code löscht/umbenennt
 * fällt der Snapshot-Diff sofort im CI auf und muss bewusst aktualisiert
 * werden (`vitest -u`).
 *
 * Quelle der Wahrheit: SQL-Migrationen in supabase/migrations für die
 * 4 SSOT-Resolver:
 *   - tutor_access_check
 *   - has_storage_entitlement
 *   - check_product_access_by_curriculum
 *   - can_access_product
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MIG_DIR = path.resolve(process.cwd(), "supabase/migrations");

// Read every migration ONCE (3k+ files); subsequent lookups are pure regex on
// in-memory strings. Keeps the snapshot test fast and deterministic even as
// the migration history grows (Cut 5.1 timeout hardening).
const ALL_MIGRATIONS: { name: string; sql: string }[] = (() => {
  if (!fs.existsSync(MIG_DIR)) return [];
  return fs
    .readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, sql: fs.readFileSync(path.join(MIG_DIR, f), "utf-8") }));
})();

function latestBody(fnName: string): string {
  let body = "";
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fnName}\\s*\\([^)]*\\)[\\s\\S]*?AS\\s+(\\$[a-zA-Z_]*\\$)([\\s\\S]*?)\\1`,
    "i",
  );
  // Cheap substring pre-filter before the heavy multiline regex.
  const needle = `FUNCTION ${fnName}`;
  const needleAlt = `FUNCTION public.${fnName}`;
  for (const { sql } of ALL_MIGRATIONS) {
    if (!sql.includes(needle) && !sql.includes(needleAlt)) continue;
    const m = sql.match(re);
    if (m) body = m[2];
  }
  return body;
}

function extractReasons(body: string): string[] {
  // Capture string literals assigned to a `reason` json key or returned
  // as part of jsonb_build_object('reason', '<code>').
  const reasons = new Set<string>();
  const patterns = [
    /'reason'\s*,\s*'([a-z0-9_]+)'/gi,
    /"reason"\s*:\s*"([a-z0-9_]+)"/gi,
    /reason\s*:?=\s*'([a-z0-9_]+)'/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(body)) !== null) reasons.add(m[1]);
  }
  return [...reasons].sort();
}

function extractFields(body: string): string[] {
  // Top-level fields appearing inside jsonb_build_object(...) of the RPC.
  const fields = new Set<string>();
  const re = /jsonb_build_object\s*\(([\s\S]*?)\)/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const inner = m[1];
    const keyRe = /'([a-z0-9_]+)'\s*,/gi;
    let k;
    while ((k = keyRe.exec(inner)) !== null) fields.add(k[1]);
  }
  return [...fields].sort();
}

const RPCS = [
  "tutor_access_check",
  "has_storage_entitlement",
  "check_product_access_by_curriculum",
  "can_access_product",
];

describe("Access-RPC response-shape contract", () => {
  for (const fn of RPCS) {
    it(`${fn}: fields + reason-codes match snapshot`, () => {
      const body = latestBody(fn);
      // Auch wenn der RPC ein simples boolean RETURNs liefert (z.B.
      // has_storage_entitlement), kann body leer sein → snapshot=`{}`.
      const shape = {
        fn,
        fields: extractFields(body),
        reason_codes: extractReasons(body),
      };
      expect(shape).toMatchSnapshot();
    });
  }

  it("known reason-code vocabulary stays stable", () => {
    // Zentraler Allowlist-Snapshot der reason-codes über ALLE Access-RPCs
    // hinweg. Neue Codes erfordern bewusste Snapshot-Aktualisierung.
    const all = new Set<string>();
    for (const fn of RPCS) {
      for (const r of extractReasons(latestBody(fn))) all.add(r);
    }
    expect([...all].sort()).toMatchSnapshot();
  });
});
