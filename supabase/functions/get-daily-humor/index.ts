// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

    if (!certification_id) return json(400, { error: "Missing certification_id" });
    if (!["daily", "random"].includes(mode)) return json(400, { error: "Invalid mode" });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Missing env" });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Identify user for opt-out + personalization
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    let userId: string | null = null;
    if (jwt) {
      const { data: u } = await supabase.auth.getUser(jwt);
      userId = u?.user?.id ?? null;
    }

    // Load user humor preferences (defaults: enabled, auto, 45-80)
    let humorEnabled = true;
    let tonePref: "auto" | "business" | "casual" = "auto";
    let modernityRange = "45-80";
    let humorPushEnabled = false;

    if (userId) {
      const { data: prefs } = await supabase
        .from("user_humor_preferences")
        .select("humor_enabled, humor_push_enabled, tone_preference, modernity_range")
        .eq("user_id", userId)
        .maybeSingle();

      if (prefs) {
        humorEnabled = prefs.humor_enabled ?? true;
        humorPushEnabled = prefs.humor_push_enabled ?? false;
        tonePref = (prefs.tone_preference ?? "auto") as any;
        modernityRange = prefs.modernity_range ?? "45-80";
      }
    }

    // Opt-out respected
    if (!humorEnabled) {
      return json(200, {
        disabled: true,
        reason: "user_opt_out",
        prefs: { humor_enabled: false, humor_push_enabled: humorPushEnabled, tone_preference: tonePref, modernity_range: modernityRange },
        humor: null,
      });
    }

    // Use user prefs for tone + modernity
    const tone = tonePref;
    const { min: modernityMin, max: modernityMax } = parseRange(modernityRange, 45, 80);

    const day = todayBerlin();
    const pick_key = `${certification_id}:${tone}:${modernityMin}-${modernityMax}`;

    const prefsPayload = { humor_enabled: true, humor_push_enabled: humorPushEnabled, tone_preference: tonePref, modernity_range: modernityRange };

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
          return json(200, { disabled: false, humor: null, fallback: { text: "Heute kein Witz im Pool – aber du bist auf Kurs. ✅", humor_type: "micro_tip", tone }, prefs: prefsPayload });
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
        return json(200, { disabled: false, humor: null, fallback: { text: "Heute bleibt's ruhig – morgen wieder 😄", humor_type: "micro_tip", tone }, prefs: prefsPayload });
      }

      await supabase.from("humor_items").update({ last_shown_at: new Date().toISOString(), shown_count: ((humor as any).shown_count ?? 0) + 1 }).eq("id", humor.id);

      return json(200, { disabled: false, day, certification_id, humor, prefs: prefsPayload });
    }

    // RANDOM
    const { data: candidates } = await baseQuery().order("quality_score", { ascending: false }).limit(60);
    const pool = (candidates ?? []).filter(isValidToday);

    if (pool.length === 0) {
      return json(200, { disabled: false, humor: null, fallback: { text: "Heute kein Humor im Pool – aber du ziehst durch. 💪", humor_type: "micro_tip", tone }, prefs: prefsPayload });
    }

    const chosen = pool[Math.floor(Math.random() * pool.length)];
    await supabase.from("humor_items").update({ last_shown_at: new Date().toISOString(), shown_count: ((chosen as any).shown_count ?? 0) + 1 }).eq("id", chosen.id);

    return json(200, { disabled: false, day, certification_id, humor: chosen, prefs: prefsPayload });
  } catch (e) {
    return json(500, { error: "unexpected_error", details: String((e as any)?.message ?? e) });
  }
});
