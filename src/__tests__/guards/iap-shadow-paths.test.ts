/**
 * IAP Shadow-Path Guard — Phase B.1
 *
 * Verbietet alternative Mobile-IAP-Pfade neben der bestehenden SSOT:
 *   - direkte Client-Reads/Writes auf `entitlements` und `store_receipts`
 *   - Helfer, die Access lokal vergeben
 *   - lokale Unlock-Keys im Browser-Storage
 *   - alternative Receipt-Validierungs-Funktionen außerhalb validate-iap-receipt
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(__dirname, "..", "..", "..");

const SCAN_DIRS = ["src"];
const ALLOW_PREFIXES = [
  "src/pages/admin/",     // Admin-Harness explizit erlaubt (read-only smoke)
  "src/components/admin/",
  "src/__tests__/",       // Guard- und Contract-Tests dürfen Symbole erwähnen
  "src/integrations/supabase/", // generated types
];

const FORBIDDEN_TABLE_READS = ["entitlements", "store_receipts"];
const FORBIDDEN_IDENTIFIERS = [
  "grantMobileAccess",
  "unlockCourseLocally",
  "createMobileEntitlement",
  "validateReceiptClientSide",
];
const FORBIDDEN_STORAGE_KEYS = [
  "mobile_access",
  "course_unlocked",
  "iap_entitlement",
  "local_entitlement",
];

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const files = SCAN_DIRS.flatMap((d) => walk(resolve(root, d)));

function isAllowed(file: string): boolean {
  const rel = file.replace(root + "/", "");
  return ALLOW_PREFIXES.some((p) => rel.startsWith(p));
}

describe("IAP shadow-path guard — Phase B.1", () => {
  it("no direct client reads/writes to entitlements/store_receipts outside admin scope", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (isAllowed(file)) continue;
      const src = readFileSync(file, "utf8");
      for (const table of FORBIDDEN_TABLE_READS) {
        const re = new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`]\\s*\\)`);
        if (re.test(src)) {
          offenders.push(`${file} → forbidden .from('${table}')`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });

  it("no shadow identifiers granting mobile access on the client", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const id of FORBIDDEN_IDENTIFIERS) {
        if (file.endsWith("iap-shadow-paths.test.ts")) continue;
        if (new RegExp(`\\b${id}\\b`).test(src)) {
          offenders.push(`${file} → forbidden identifier ${id}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });

  it("no local IAP unlock keys in Browser-Storage", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith("iap-shadow-paths.test.ts")) continue;
      const src = readFileSync(file, "utf8");
      for (const key of FORBIDDEN_STORAGE_KEYS) {
        if (src.includes(`"${key}"`) || src.includes(`'${key}'`)) {
          offenders.push(`${file} → forbidden storage key ${key}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });
});
