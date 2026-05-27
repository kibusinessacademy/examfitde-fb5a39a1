/**
 * VerwaltungsOS — Bund-API Lagebild v1
 *
 * Aggregiert öffentliche, keyless Bund-APIs (bund.dev) zu einem
 * verwaltungstauglichen Echtzeit-Lagebild pro Region:
 *
 *  - NINA (Bundesamt für Bevölkerungsschutz): aktive Warnungen
 *    (MoWaS, Wetter (DWD), Hochwasser, Polizei, BIWAPP)
 *  - Pegel-Online (Wasserstraßen- und Schifffahrtsverwaltung):
 *    aktuelle Wasserstände relevanter Pegel
 *
 * Vertrag:
 *  - Public, read-only Aggregator (kein Schreibpfad)
 *  - Keine Persistenz, in-memory 60s Cache pro ARS
 *  - Anti-Drift: KEINE eigene Bewertung/Generation — nur Pass-Through
 *    + leichte Normalisierung. Quelle wird in jedem Item mitgeführt.
 *  - CORS offen, verify_jwt=false (public data)
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface LagebildRequest {
  ars?: string;        // 12-stelliger Amtlicher Regionalschlüssel (NINA)
  region_name?: string; // optionales Label
  include_pegel?: boolean;
}

interface WarningItem {
  source: "MOWAS" | "DWD" | "LHP" | "POLICE" | "BIWAPP" | "UNKNOWN";
  id: string;
  headline: string;
  severity: string | null;
  urgency: string | null;
  effective: string | null;
  expires: string | null;
  sender: string | null;
  area: string | null;
}

interface PegelItem {
  station: string;
  water: string;
  longname: string;
  value: number | null;
  unit: string;
  timestamp: string | null;
  trend: number | null;
}

interface LagebildResponse {
  ars: string | null;
  region_name: string | null;
  fetched_at: string;
  warnings: WarningItem[];
  pegel: PegelItem[];
  errors: { source: string; message: string }[];
  meta: {
    sources: string[];
    cache: "hit" | "miss";
    nina_count: number;
    pegel_count: number;
  };
}

// 60-Sekunden In-Memory-Cache pro ARS (Edge-Worker scoped)
const CACHE = new Map<string, { at: number; data: LagebildResponse }>();
const CACHE_TTL_MS = 60_000;

function classifySource(provider: string | undefined, sender: string | undefined): WarningItem["source"] {
  const p = (provider || "").toUpperCase();
  if (p.includes("MOWAS")) return "MOWAS";
  if (p.includes("DWD")) return "DWD";
  if (p.includes("LHP")) return "LHP";
  if (p.includes("POLICE") || p.includes("POLIZEI")) return "POLICE";
  if (p.includes("BIWAPP")) return "BIWAPP";
  const s = (sender || "").toLowerCase();
  if (s.includes("wetterdienst")) return "DWD";
  if (s.includes("hochwasser")) return "LHP";
  return "UNKNOWN";
}

async function fetchNina(ars: string): Promise<{ warnings: WarningItem[]; error?: string }> {
  // Dashboard: aktuelle Warnungen für eine Region (ARS, ggf. Präfix)
  // Doku: https://nina.api.bund.dev / https://warnung.bund.de/api31
  const url = `https://warnung.bund.de/api31/dashboard/${encodeURIComponent(ars)}.json`;
  try {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) return { warnings: [], error: `NINA HTTP ${r.status}` };
    const json = await r.json();
    if (!Array.isArray(json)) return { warnings: [] };
    const warnings: WarningItem[] = json.map((w: Record<string, unknown>) => {
      const payload = (w?.payload as Record<string, unknown>) || {};
      const data = (payload?.data as Record<string, unknown>) || {};
      const headline =
        (data?.headline as string) ||
        ((data?.transKeys as Record<string, string>)?.event as string) ||
        (w?.i18nTitle as string) ||
        "Warnung";
      const area =
        (data?.area as string) ||
        (((data?.info as Array<Record<string, unknown>>)?.[0]?.area as Array<Record<string, unknown>>)?.[0]?.areaDesc as string) ||
        null;
      return {
        source: classifySource(payload?.id as string, data?.sender as string),
        id: (w?.id as string) || crypto.randomUUID(),
        headline,
        severity: (data?.severity as string) || null,
        urgency: (data?.urgency as string) || null,
        effective: (w?.sent as string) || (data?.sent as string) || null,
        expires: (data?.expires as string) || null,
        sender: (data?.sender as string) || null,
        area,
      };
    });
    return { warnings };
  } catch (e) {
    return { warnings: [], error: e instanceof Error ? e.message : "NINA fetch failed" };
  }
}

async function fetchPegel(): Promise<{ pegel: PegelItem[]; error?: string }> {
  // Pegel-Online liefert keinen ARS-Filter; wir holen einen Top-Slice
  // (Rhein/Elbe/Donau Kernpegel) als Demonstrations-Lagebild.
  // Doku: https://www.pegelonline.wsv.de/webservices/rest-api/v2
  const url =
    "https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?prettyprint=false&waters=RHEIN,ELBE,DONAU&includeTimeseries=true&includeCurrentMeasurement=true";
  try {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) return { pegel: [], error: `Pegel HTTP ${r.status}` };
    const json = await r.json();
    if (!Array.isArray(json)) return { pegel: [] };
    const pegel: PegelItem[] = json.slice(0, 40).map((s: Record<string, unknown>) => {
      const ts = (s?.timeseries as Array<Record<string, unknown>>)?.find?.(
        (t) => (t?.shortname as string) === "W",
      );
      const cm = (ts?.currentMeasurement as Record<string, unknown>) || {};
      return {
        station: (s?.shortname as string) || (s?.longname as string) || "?",
        longname: (s?.longname as string) || "",
        water: ((s?.water as Record<string, unknown>)?.longname as string) || "",
        value: typeof cm?.value === "number" ? (cm.value as number) : null,
        unit: (ts?.unit as string) || "cm",
        timestamp: (cm?.timestamp as string) || null,
        trend: typeof cm?.trend === "number" ? (cm.trend as number) : null,
      };
    });
    return { pegel };
  } catch (e) {
    return { pegel: [], error: e instanceof Error ? e.message : "Pegel fetch failed" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let body: LagebildRequest = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    } else {
      const u = new URL(req.url);
      body = {
        ars: u.searchParams.get("ars") || undefined,
        region_name: u.searchParams.get("region_name") || undefined,
        include_pegel: u.searchParams.get("include_pegel") === "true",
      };
    }

    const ars = (body.ars || "").trim();
    if (!ars || !/^\d{6,12}$/.test(ars)) {
      return new Response(
        JSON.stringify({ error: "ars (6–12 digit ARS) required" }),
        { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    const cacheKey = `${ars}|${body.include_pegel ? "1" : "0"}`;
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return new Response(JSON.stringify({ ...cached.data, meta: { ...cached.data.meta, cache: "hit" } }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const errors: { source: string; message: string }[] = [];
    const [nina, pegel] = await Promise.all([
      fetchNina(ars),
      body.include_pegel ? fetchPegel() : Promise.resolve({ pegel: [] as PegelItem[] }),
    ]);
    if (nina.error) errors.push({ source: "NINA", message: nina.error });
    if ("error" in pegel && pegel.error) errors.push({ source: "PEGEL", message: pegel.error });

    const out: LagebildResponse = {
      ars,
      region_name: body.region_name || null,
      fetched_at: new Date().toISOString(),
      warnings: nina.warnings,
      pegel: pegel.pegel,
      errors,
      meta: {
        sources: ["NINA (warnung.bund.de)", body.include_pegel ? "Pegel-Online (WSV)" : ""].filter(Boolean),
        cache: "miss",
        nina_count: nina.warnings.length,
        pegel_count: pegel.pegel.length,
      },
    };

    CACHE.set(cacheKey, { at: Date.now(), data: out });
    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "internal error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
