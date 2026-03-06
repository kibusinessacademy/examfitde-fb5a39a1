import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Normalize a beruf name for fuzzy matching: strip /-in, /-frau, lowercase, trim */
function normalizeName(input: string): string {
  return input
    .replace(/\/-?(in|frau|mann|leute)$/i, "")
    .replace(/\s*\(.*?\)\s*/g, "")
    .replace(/[-/]$/, "")
    .toLowerCase()
    .trim();
}

/** Parse tier string like "Tier 1" → 1 */
function parseTier(val: string | number | null | undefined): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const m = val.match(/(\d)/);
    if (m) return parseInt(m[1], 10);
  }
  return 4;
}

type CsvRow = Record<string, string>;

/**
 * import-market-data
 * Accepts JSON body: { rows: CsvRow[] }
 * Each row must have at least: occupation, market_score
 * Matches against berufe.bezeichnung_kurz using fuzzy normalization.
 * Returns match report.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Admin guard
  const authHeader = req.headers.get("authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const { data: roleRow } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) return json({ error: "Forbidden: admin only" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const rows: CsvRow[] = body.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ error: "body.rows must be a non-empty array" }, 400);
    }

    // 1) Load all berufe for matching
    const { data: alleBerufe, error: berufErr } = await sb
      .from("berufe")
      .select("id, bezeichnung_kurz")
      .order("bezeichnung_kurz");
    if (berufErr) throw new Error(`Load berufe: ${berufErr.message}`);

    // 2) Load existing match map
    const { data: matchMap } = await sb
      .from("beruf_market_match_map")
      .select("source_occupation_name, beruf_id");

    const manualMap = new Map<string, string>();
    for (const m of matchMap ?? []) {
      manualMap.set(m.source_occupation_name.toLowerCase().trim(), m.beruf_id);
    }

    // 3) Build normalized lookup
    const normLookup = new Map<string, { id: string; name: string }>();
    for (const b of alleBerufe ?? []) {
      const norm = normalizeName(b.bezeichnung_kurz);
      normLookup.set(norm, { id: b.id, name: b.bezeichnung_kurz });
    }

    // 4) Match each CSV row
    const matched: Array<{ beruf_id: string; row: CsvRow; match_type: string }> = [];
    const unmatched: Array<{ occupation: string; rank: string }> = [];

    for (const row of rows) {
      const occupation = (row.occupation ?? "").trim();
      if (!occupation) continue;

      // Try manual map first
      const manualId = manualMap.get(occupation.toLowerCase().trim());
      if (manualId) {
        matched.push({ beruf_id: manualId, row, match_type: "manual_map" });
        continue;
      }

      // Try exact match on bezeichnung_kurz
      const exactMatch = (alleBerufe ?? []).find(
        (b) => b.bezeichnung_kurz.toLowerCase().trim() === occupation.toLowerCase().trim()
      );
      if (exactMatch) {
        matched.push({ beruf_id: exactMatch.id, row, match_type: "exact" });
        continue;
      }

      // Try normalized match
      const normOcc = normalizeName(occupation);
      const normMatch = normLookup.get(normOcc);
      if (normMatch) {
        matched.push({ beruf_id: normMatch.id, row, match_type: "normalized" });
        continue;
      }

      // Try startsWith match (CSV "Kaufmann für X" → DB "Kaufmann/-frau für X")
      const startsMatch = (alleBerufe ?? []).find((b) => {
        const normB = normalizeName(b.bezeichnung_kurz);
        return normB.startsWith(normOcc) || normOcc.startsWith(normB);
      });
      if (startsMatch) {
        matched.push({ beruf_id: startsMatch.id, row, match_type: "prefix" });
        continue;
      }

      unmatched.push({ occupation, rank: row.priority_rank ?? "?" });
    }

    // 5) Upsert matched rows into beruf_market_data
    let upsertCount = 0;
    let upsertErrors: string[] = [];

    for (const m of matched) {
      const r = m.row;
      const { error: uErr } = await sb
        .from("beruf_market_data")
        .upsert(
          {
            beruf_id: m.beruf_id,
            occupation_name: (r.occupation ?? "").trim(),
            official_no: parseInt(r.official_no) || null,
            azubi_count: Math.round(parseFloat(r.naa_2025) || 0),
            demand_percentile: parseFloat(r.demand_percentile) || 0,
            fit_score: parseFloat(r.fit_score_input) || 0,
            gender_balance_score: parseFloat(r.gender_balance_score) || 0,
            coverage_score: parseFloat(r.coverage_score) || 0,
            market_score: parseFloat(r.market_score) || 0,
            tier: parseTier(r.tier),
            priority_rank: parseInt(r.priority_rank) || null,
            est_penetration_pct: parseFloat(r.est_penetration_pct) || 0,
            est_arpu_eur: parseFloat(r.est_arpu_eur) || 0,
            est_annual_revenue_eur: parseFloat(r.est_annual_revenue_eur) || 0,
            source_year: 2026,
            source_note: "Masterliste 2026 CSV import",
            match_quality: r.match_quality ?? m.match_type,
            is_manual_override: false,
          },
          { onConflict: "beruf_id", ignoreDuplicates: false }
        );

      if (uErr) {
        upsertErrors.push(`${r.occupation}: ${uErr.message}`);
      } else {
        upsertCount++;
      }
    }

    // 6) Recalculate scores
    await sb.rpc("recalculate_beruf_market_scores");

    // 7) Save new matches to match map for future imports
    const newMappings = matched
      .filter((m) => m.match_type !== "manual_map")
      .map((m) => ({
        source_occupation_name: (m.row.occupation ?? "").trim(),
        beruf_id: m.beruf_id,
        match_type: m.match_type,
      }));

    if (newMappings.length > 0) {
      await sb
        .from("beruf_market_match_map")
        .upsert(newMappings, { onConflict: "source_occupation_name", ignoreDuplicates: true });
    }

    console.log(
      `[ImportMarket] Done: ${upsertCount} upserted, ${unmatched.length} unmatched, ${upsertErrors.length} errors`
    );

    return json({
      summary: {
        total_rows: rows.length,
        matched: matched.length,
        upserted: upsertCount,
        unmatched: unmatched.length,
        errors: upsertErrors.length,
      },
      match_breakdown: {
        exact: matched.filter((m) => m.match_type === "exact").length,
        normalized: matched.filter((m) => m.match_type === "normalized").length,
        prefix: matched.filter((m) => m.match_type === "prefix").length,
        manual_map: matched.filter((m) => m.match_type === "manual_map").length,
      },
      unmatched,
      errors: upsertErrors.slice(0, 20),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ImportMarket] Error: ${msg}`);
    return json({ error: msg }, 500);
  }
});
