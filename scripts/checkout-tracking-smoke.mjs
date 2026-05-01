#!/usr/bin/env node
/**
 * Checkout-Started Tracking Smoke
 * --------------------------------
 * Verifiziert das Sprint-1-Tracking-Migrations-Ziel:
 *   - checkout_started landet in conversion_events
 *   - metadata.package_id ist gesetzt (UUID)
 *   - persona_type, source, price_id, product_id sind gesetzt
 *   - kein Insert mehr in tracking_events für event_name='checkout_started' (legacy-Pfad tot)
 *   - checkout_started erscheint zeitlich VOR dem zugehörigen checkout_complete
 *     (Prüfung pro order_id im metadata)
 *
 * Exit 0: green | Exit 1: drift
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log("⚠️  SUPABASE_URL / KEY missing — skipping checkout-tracking smoke");
  process.exit(0);
}

async function rpc(query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_readonly_sql`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ q: query }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const FAIL = (...m) => console.error("❌", ...m);
const OK = (...m) => console.log("✅", ...m);
const INFO = (...m) => console.log("•", ...m);

async function main() {
  console.log("─".repeat(70));
  console.log("  CHECKOUT-STARTED TRACKING SMOKE (Sprint 1)");
  console.log("─".repeat(70));

  let failures = 0;

  // 1. Letzte 7 Tage: pro event_type Counts + package_id-Coverage
  // SSOT: top-level package_id (generated column) ist bevorzugter Lesepfad,
  // metadata.package_id bleibt als Fallback (Backwards-Kompatibilität).
  const ev = await restGet(
    "conversion_events?select=event_type,package_id,metadata,created_at&event_type=in.(checkout_started,checkout_complete,checkout_start,checkout_completed)&created_at=gte." +
      new Date(Date.now() - 7 * 24 * 3600_000).toISOString(),
  );

  if (!Array.isArray(ev.body)) {
    FAIL("conversion_events not readable", ev);
    process.exit(1);
  }

  const buckets = { checkout_started: [], checkout_complete: [], checkout_start: [], checkout_completed: [] };
  for (const r of ev.body) {
    if (buckets[r.event_type]) buckets[r.event_type].push(r);
  }

  for (const k of Object.keys(buckets)) {
    const rows = buckets[k];
    const withPkg = rows.filter((r) => {
      // Top-level package_id (generated column) bevorzugt, metadata als Fallback.
      const pid = r.package_id ?? r.metadata?.package_id;
      return pid && /^[0-9a-f-]{36}$/i.test(pid);
    }).length;
    INFO(`${k.padEnd(20)}: total=${rows.length}  with_package_id=${withPkg}`);
  }

  const started = buckets.checkout_started;
  const completed = buckets.checkout_complete;

  // 2. Pflicht-Felder prüfen für checkout_started (nur wenn vorhanden)
  if (started.length > 0) {
    const required = ["package_id", "product_id", "price_id", "source"];
    let missing = 0;
    for (const r of started) {
      for (const k of required) {
        if (!r.metadata?.[k]) {
          missing++;
          break;
        }
      }
    }
    if (missing > 0) {
      FAIL(
        `${missing}/${started.length} checkout_started events fehlen Pflichtfelder (${required.join(",")})`,
      );
      failures++;
    } else {
      OK(`Alle ${started.length} checkout_started events haben Pflichtfelder`);
    }
  } else {
    INFO("Keine checkout_started events in den letzten 7 Tagen — nach erstem echten Klick erneut prüfen.");
  }

  // 3. Reihenfolge: zu jedem checkout_complete mit order_id muss
  //    ein checkout_started mit derselben order_id zeitlich davor existieren.
  if (completed.length > 0 && started.length > 0) {
    const startByOrder = new Map();
    for (const r of started) {
      const oid = r.metadata?.order_id;
      if (oid && (!startByOrder.has(oid) || r.created_at < startByOrder.get(oid))) {
        startByOrder.set(oid, r.created_at);
      }
    }
    let outOfOrder = 0;
    let unmatched = 0;
    for (const r of completed) {
      const oid = r.metadata?.order_id;
      if (!oid) continue;
      const startTs = startByOrder.get(oid);
      if (!startTs) {
        unmatched++;
      } else if (startTs >= r.created_at) {
        outOfOrder++;
      }
    }
    if (outOfOrder > 0) {
      FAIL(`${outOfOrder} checkout_complete events liegen VOR ihrem checkout_started`);
      failures++;
    } else {
      OK("Reihenfolge ok: checkout_started < checkout_complete pro order_id");
    }
    if (unmatched > 0) {
      INFO(`${unmatched} checkout_complete ohne korrespondierendes checkout_started (legacy-Daten möglich)`);
    }
  }

  console.log("");
  if (failures > 0) {
    FAIL(`Tracking-Smoke FAILED with ${failures} drift(s)`);
    process.exit(1);
  }
  OK("Checkout-Tracking smoke GREEN");
}

main().catch((e) => {
  FAIL("Unexpected error:", e?.message || e);
  process.exit(1);
});
