// SELL.HEALTH.OS.1 — Admin-only safe healing actions.
// Wraps existing SECURITY DEFINER RPCs. No new business logic.
import { requireAdmin, handleCors, json } from "../_shared/adminGuard.ts";

interface Body {
  action: "regrant_paid_order" | "bulk_publish_done";
  order_id?: string;
  cap?: number;
  default_price_cents?: number;
  default_access_months?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const ctx = await requireAdmin(req);
  if (ctx instanceof Response) return ctx;
  const sb = ctx.sb;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (body.action === "regrant_paid_order") {
    if (!body.order_id || !UUID.test(body.order_id)) {
      return json({ error: "invalid_order_id" }, 400);
    }
    const { error } = await sb.rpc("process_order_paid_fulfillment", { p_order_id: body.order_id });
    if (error) return json({ error: "rpc_failed", detail: error.message }, 500);

    const { data: verify } = await sb
      .from("v_admin_paid_orders_ops")
      .select("order_id,has_grant,ops_status,fulfillable_item_count,item_count")
      .eq("order_id", body.order_id)
      .maybeSingle();

    return json({
      ok: true,
      action: "regrant_paid_order",
      order_id: body.order_id,
      result: verify ?? null,
      healed: verify?.has_grant === true || verify?.ops_status === "granted",
    });
  }

  if (body.action === "bulk_publish_done") {
    const cap = Math.min(Math.max(Number(body.cap ?? 18), 1), 50);
    // SSOT-Hardlock: B2C Bundle = 24,90 € / 12 Monate (src/config/pricing.ts).
    // Client-Inputs werden ignoriert — nur SSOT-Werte werden an die RPC übergeben.
    const SSOT_PRICE_CENTS = 2490;
    const SSOT_ACCESS_MONTHS = 12;

    const { data, error } = await sb.rpc("admin_bulk_publish_done_packages", {
      p_cap: cap,
      p_default_price_cents: SSOT_PRICE_CENTS,
      p_default_access_months: SSOT_ACCESS_MONTHS,
    });
    if (error) return json({ error: "rpc_failed", detail: error.message }, 500);

    return json({
      ok: true,
      action: "bulk_publish_done",
      cap,
      default_price_cents: SSOT_PRICE_CENTS,
      default_access_months: SSOT_ACCESS_MONTHS,
      ssot_enforced: true,
      result: data,
    });
  }

  return json({ error: "unknown_action" }, 400);
});
