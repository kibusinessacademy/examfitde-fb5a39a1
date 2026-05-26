/**
 * Signal collectors for the BerufOS Smart Setup Recommendations engine.
 *
 * Every collector wraps a SECURITY DEFINER admin_* RPC and degrades
 * gracefully (returns null) when the caller is not authorized or the
 * RPC payload doesn't match — engine then simply skips that category.
 */
import { supabase } from "@/integrations/supabase/client";
import type { RecSignals } from "./recommendations";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc as any;

async function safe<T>(call: Promise<{ data: unknown; error: unknown }>): Promise<T | null> {
  try {
    const { data, error } = await call;
    if (error) return null;
    return data as T;
  } catch { return null; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = (o: any, k: string, fb = 0) => (typeof o?.[k] === "number" ? o[k] : fb);

export async function collectSignals(orgId: string | null): Promise<RecSignals> {
  const [wizardsRaw, customerSafe, dataHoles, commerce, empty, sellability, graph, healAlerts, ai, lane] =
    await Promise.all([
      orgId ? safe<{ states?: Array<{ wizard_key: string; status: string }> }>(
        rpc("setup_wizard_list_for_org", { _org_id: orgId })
      ) : Promise.resolve(null),
      safe<unknown>(rpc("admin_get_customer_safe_summary")),
      safe<unknown>(rpc("admin_get_data_holes_summary")),
      safe<unknown>(rpc("admin_get_commerce_gap_summary")),
      safe<unknown>(rpc("admin_get_empty_published_courses")),
      safe<unknown>(rpc("admin_get_content_sellability_summary")),
      safe<unknown>(rpc("admin_get_berufos_graph_summary")),
      safe<unknown>(rpc("admin_get_heal_alerts_summary")),
      safe<unknown>(rpc("admin_get_ai_observability_summary")),
      safe<unknown>(rpc("admin_get_lane_health")),
    ]);

  // Normalize wizards
  let wizards: RecSignals["wizards"] = null;
  if (wizardsRaw && Array.isArray(wizardsRaw.states)) {
    const by_key: Record<string, RecSignals["wizards"] extends infer T ? T extends { by_key: infer B } ? B : never : never> =
      {} as never;
    let connected = 0, in_progress = 0, error = 0;
    for (const s of wizardsRaw.states) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (by_key as any)[s.wizard_key] = s.status;
      if (s.status === "connected") connected++;
      else if (s.status === "in_progress") in_progress++;
      else if (s.status === "error") error++;
    }
    wizards = { total: wizardsRaw.states.length, connected, in_progress, error, by_key };
  }

  return {
    wizards,
    customer_safe: customerSafe
      ? {
          customer_safe: get(customerSafe, "customer_safe"),
          not_ready: get(customerSafe, "not_ready"),
          total: get(customerSafe, "total"),
        }
      : null,
    data_holes: dataHoles
      ? {
          total: get(dataHoles, "total"),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          by_kind: Array.isArray((dataHoles as any).by_kind) ? (dataHoles as any).by_kind : [],
        }
      : null,
    commerce_gap: commerce
      ? {
          published_without_price: get(commerce, "published_without_price"),
          published_without_landing: get(commerce, "published_without_landing"),
          total_published: get(commerce, "total_published"),
        }
      : null,
    empty_courses: empty
      ? { count: Array.isArray(empty) ? empty.length : get(empty, "count") }
      : null,
    content_sellability: sellability
      ? {
          ready: get(sellability, "ready"),
          blocked: get(sellability, "blocked"),
          total: get(sellability, "total"),
        }
      : null,
    graph: graph
      ? {
          skills: get(graph, "skills"),
          competencies: get(graph, "competencies"),
          workflows: get(graph, "workflows"),
          outcomes: get(graph, "outcomes"),
          recoveries: get(graph, "recoveries"),
        }
      : null,
    heal_alerts: healAlerts
      ? { open: get(healAlerts, "open"), critical: get(healAlerts, "critical") }
      : null,
    ai_observability: ai
      ? {
          tutor_no_evidence: get(ai, "tutor_no_evidence"),
          failed_24h: get(ai, "failed_24h"),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          avg_cost_per_call: typeof (ai as any).avg_cost_per_call === "number" ? (ai as any).avg_cost_per_call : null,
        }
      : null,
    lane_health: lane
      ? {
          stuck_processing: get(lane, "stuck_processing"),
          pending: get(lane, "pending"),
          failed_15m: get(lane, "failed_15m"),
        }
      : null,
  };
}
