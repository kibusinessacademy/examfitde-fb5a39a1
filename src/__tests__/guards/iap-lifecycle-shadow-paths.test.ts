/**
 * IAP Lifecycle Shadow-Path Guard — extends iap-shadow-paths.test.ts
 * for the IAP.STATUS.LIFECYCLE cut.
 *
 * Verbietet im Client:
 *   - Aufrufe von revoke_/suspend_/restore_store_entitlement
 *   - Persistenz von Raw-Webhook-Payloads (signedPayload, pubsub raw)
 *   - direkte .from('store_receipt_events')
 *   - lokale Shadow-Statusspeicher für IAP-Lifecycle
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(__dirname, "..", "..", "..");

const SCAN_DIRS = ["src"];
const ALLOW_PREFIXES = [
  "src/pages/admin/",
  "src/components/admin/",
  "src/__tests__/",
  "src/integrations/supabase/",
];

const FORBIDDEN_RPCS = [
  "revoke_store_entitlement",
  "suspend_store_entitlement",
  "restore_store_entitlement",
];

const FORBIDDEN_RAW_PAYLOAD_KEYS = [
  "signedPayload",
  "pubsubRawMessage",
];

const FORBIDDEN_SHADOW_STATUS_KEYS = [
  "iap_status",
  "subscription_status",
  "iap_lifecycle",
];

const FORBIDDEN_CLIENT_HANDLERS = [
  "clientRefundHandler",
  "clientCancelHandler",
  "clientRevokeHandler",
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
const SELF = "iap-lifecycle-shadow-paths.test.ts";

function isAllowed(file: string): boolean {
  const rel = file.replace(root + "/", "");
  return ALLOW_PREFIXES.some((p) => rel.startsWith(p));
}

describe("IAP Lifecycle shadow-path guard", () => {
  it("no client calls to lifecycle RPCs", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(SELF)) continue;
      if (isAllowed(file)) continue;
      const src = readFileSync(file, "utf8");
      for (const rpc of FORBIDDEN_RPCS) {
        if (new RegExp(`['"\`]${rpc}['"\`]`).test(src)) {
          offenders.push(`${file} → forbidden RPC ${rpc} (server-only)`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });

  it("no raw webhook payload persistence in client", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(SELF)) continue;
      const src = readFileSync(file, "utf8");
      for (const key of FORBIDDEN_RAW_PAYLOAD_KEYS) {
        // permit type references; only forbid stored/property writes
        if (new RegExp(`\\.${key}\\s*=`).test(src) || new RegExp(`set\\(['"\`]${key}['"\`]`).test(src)) {
          offenders.push(`${file} → stores raw payload key ${key}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });

  it("no direct client reads/writes to store_receipt_events", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(SELF)) continue;
      if (isAllowed(file)) continue;
      const src = readFileSync(file, "utf8");
      if (/\.from\(\s*['"`]store_receipt_events['"`]\s*\)/.test(src)) {
        offenders.push(`${file} → forbidden .from('store_receipt_events')`);
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });

  it("no shadow lifecycle status in browser storage", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(SELF)) continue;
      const src = readFileSync(file, "utf8");
      for (const key of FORBIDDEN_SHADOW_STATUS_KEYS) {
        if (src.includes(`"${key}"`) || src.includes(`'${key}'`)) {
          offenders.push(`${file} → forbidden shadow status key ${key}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });

  it("no client-side refund/cancel/revoke handlers", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(SELF)) continue;
      const src = readFileSync(file, "utf8");
      for (const id of FORBIDDEN_CLIENT_HANDLERS) {
        if (new RegExp(`\\b${id}\\b`).test(src)) {
          offenders.push(`${file} → forbidden client handler ${id}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });
});
