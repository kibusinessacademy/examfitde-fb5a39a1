import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
const ANON = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");

async function call(payload: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/validate-blueprint-variants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON}`,
      apikey: ANON ?? "",
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  return { status: res.status, json };
}

Deno.test("missing scope → ok=false + noop_reason", async () => {
  const { json } = await call({});
  assertEquals(json.ok, false);
  assert(typeof json.noop_reason === "string" && json.noop_reason.length > 0);
  assertEquals(json.reviewed_count, 0);
  assertEquals(json.status_changed_count, 0);
});

Deno.test("unknown package → ok=false + noop_reason no_blueprints_in_scope or scope_unresolvable", async () => {
  // Random uuid that won't resolve
  const { json } = await call({ package_id: "00000000-0000-0000-0000-000000000000" });
  assertEquals(json.ok, false);
  assert(
    json.noop_reason === "no_blueprints_in_scope" ||
      json.noop_reason === "scope_unresolvable",
    `unexpected noop_reason: ${json.noop_reason}`,
  );
  assertEquals(json.reviewed_count, 0);
});

Deno.test("contract: response always has reviewed/rejected/approved/status_changed counts", async () => {
  const { json } = await call({});
  for (const k of ["reviewed_count", "rejected_count", "approved_count", "status_changed_count"]) {
    assert(k in json, `missing key ${k}`);
    assertEquals(typeof json[k], "number");
  }
});
