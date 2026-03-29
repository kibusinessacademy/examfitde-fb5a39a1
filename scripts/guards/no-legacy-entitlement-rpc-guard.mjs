#!/usr/bin/env node
/**
 * Guard: No Legacy Entitlement RPC Usage
 * Blocks any active call to deleted legacy RPCs.
 * Allowlist: deprecated stubs, test files, docs, types.
 */
import { execSync } from "node:child_process";

const BANNED = [
  "check_user_entitlement",
  "get_user_entitlements_v2",
  "get_user_entitlements",
];

const ALLOWLIST = [
  "useEntitlements.ts",
  "types.ts",
  "wave2-entitlement-matrix.test",
  ".md",
  "GUARD_REGISTRY.md",
  "channel-architecture",
  "no-legacy-entitlement-rpc-guard",
];

function isAllowed(file) {
  return ALLOWLIST.some((a) => file.includes(a));
}

let failed = false;

for (const rpc of BANNED) {
  try {
    const out = execSync(`grep -rn "${rpc}" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" src/ supabase/functions/ scripts/ 2>/dev/null || true`)
      .toString("utf8")
      .trim();
    if (!out) continue;
    for (const line of out.split("\n").filter(Boolean)) {
      const file = line.split(":")[0];
      if (isAllowed(file)) continue;
      console.error(`❌ LEGACY RPC REFERENCE: ${rpc} in ${line}`);
      failed = true;
    }
  } catch {
    // grep found nothing
  }
}

if (failed) {
  console.error("\n❌ Legacy entitlement RPCs are deleted. Use check_product_access_by_curriculum / can_access_product instead.");
  process.exit(1);
} else {
  console.log("✅ No legacy entitlement RPC references found.");
}
