import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function todayBerlin(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function parseRange(r: string | null, defMin: number, defMax: number) {
  if (!r) return { min: defMin, max: defMax };
  const m = r.match(/^(\d{1,3})-(\d{1,3})$/);
  if (!m) return { min: defMin, max: defMax };
  const a = Math.max(0, Math.min(100, parseInt(m[1], 10)));
  const b = Math.max(0, Math.min(100, parseInt(m[2], 10)));
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "GET") return json(405, { error: "Method not allowed" });

    const url = new URL(req.url);
    const certification_id = url.searchParams.get("certification_id");
    const mode = (url.searchParams.get("mode") ?? "daily").toLowerCase();
    const tone = (url.searchParams.get("tone") ?? "auto").toLowerCase();
    const modernity = url.searchParams.get("modernity");
    const { min: modernityMin, max: modernityMax } = parseRange(modernity, 40, 80);

    if (!certification_id) return json(400, { error: "Missing certification_id" });
    if (!["daily", "random"].includes(mode)) return json(400, { error: "Invalid mode" });
    if (!["business", "casual", "auto"].includes(tone)) return json(400, { error: "Invalid tone" });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing env" });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const day = todayBerlin();
    const pick_key = `${certification_id}:${tone}:${modernityMin}-${modernityMax}`;

    const isValidToday = (row: any) => {
      if (row.valid_from && row.valid_from > day) return false;
      if (row.valid_to && row.valid_to < day) return false;
      return true;
    };

    const baseQuery = () => {
      let q = supabase
        .from("humor_items")
        .select("id, text, humor_type, tone, modernity_level, competence_id, lesson_id, status, safety_score, last_shown_at, shown_count, quality_score, valid_from, valid_to")
        .eq("certification_id", certification_id)
        .in("status", ["approved", "frozen"])
        .gte("modernity_level", modernityMin)
        .lte("modernity_level", modernityMax);
      if (tone !== "auto") q = q.eq("tone", tone);
      return q;
    };

    if (mode === "daily") {
      const { data: pick } = await supabase
        .from("humor_daily_pick")
        .select("humor_id")
        .eq("day", day)
        .eq("pick_key", pick_key)
        .maybeSingle();

      let humorId: string | undefined = pick?.humor_id as any;

      if (!humorId) {
        const { data: candidates } = await baseQuery().order("quality_score", { ascending: false }).limit(80);
        const pool = (candidates ?? []).filter(isValidToday);

        if (pool.length === 0) {
          return json(200, { humor: null, fallback: { text: "Heute kein Witz im Pool – aber du bist auf Kurs. ✅", humor_type: "micro_tip", tone } });
        }

        pool.sort((a: any, b: any) => {
          const at = a.last_shown_at ? new Date(a.last_shown_at).getTime() : 0;
          const bt = b.last_shown_at ? new Date(b.last_shown_at).getTime() : 0;
          if (at !== bt) return at - bt;
          return (b.quality_score ?? 0) - (a.quality_score ?? 0);
        });

        humorId = pool[0].id;

        const { error: insErr } = await supabase.from("humor_daily_pick").insert({ day, pick_key, humor_id: humorId });
        if (insErr) {
          const { data: pick2 } = await supabase.from("humor_daily_pick").select("humor_id").eq("day", day).eq("pick_key", pick_key).maybeSingle();
          humorId = (pick2?.humor_id as any) ?? humorId;
        }
      }

      const { data: humor } = await supabase
        .from("humor_items")
        .select("id, text, humor_type, tone, modernity_level, competence_id, lesson_id, status, safety_score, shown_count, valid_from, valid_to")
        .eq("id", humorId)
        .in("status", ["approved", "frozen"])
        .maybeSingle();

      if (!humor || !isValidToday(humor)) {
        return json(200, { humor: null, fallback: { text: "Heute bleibt's ruhig – morgen wieder 😄", humor_type: "micro_tip", tone } });
      }

      await supabase.from("humor_items").update({ last_shown_at: new Date().toISOString(), shown_count: ((humor as any).shown_count ?? 0) + 1 }).eq("id", humor.id);

      return json(200, { day, certification_id, tone, modernity: `${modernityMin}-${modernityMax}`, humor });
    }

    // RANDOM
    const { data: candidates } = await baseQuery().order("quality_score", { ascending: false }).limit(60);
    const pool = (candidates ?? []).filter(isValidToday);

    if (pool.length === 0) {
      return json(200, { humor: null, fallback: { text: "Heute kein Humor im Pool – aber du ziehst durch. 💪", humor_type: "micro_tip", tone } });
    }

    const chosen = pool[Math.floor(Math.random() * pool.length)];
    await supabase.from("humor_items").update({ last_shown_at: new Date().toISOString(), shown_count: ((chosen as any).shown_count ?? 0) + 1 }).eq("id", chosen.id);

    return json(200, { day, certification_id, tone, modernity: `${modernityMin}-${modernityMax}`, humor: chosen });
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) });
  }
});
