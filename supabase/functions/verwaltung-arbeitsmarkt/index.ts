/**
 * VerwaltungsOS — Arbeitsmarkt-Lagebild v1 (Bundesagentur für Arbeit)
 *
 * Aggregiert die öffentliche, keyless Jobsuche-API der Bundesagentur für Arbeit
 * (bund.dev / arbeitsagentur.de) zu einem berufs-zentrierten Lagebild:
 *
 *  - Stellenangebote pro Beruf (+ optional Ort/Umkreis)
 *  - Aggregationen: Top-Arbeitgeber, Top-Orte, Veröffentlichungstrend (7/14/30 Tage)
 *
 * Vertrag:
 *  - Public, read-only Aggregator (kein Schreibpfad, keine Persistenz)
 *  - In-memory 5-Min-Cache pro Query-Key
 *  - Anti-Drift: KEINE eigene Bewertung/Generation — nur Pass-Through + leichte
 *    Normalisierung. Quelle wird in jedem Item mitgeführt ("source": "BA_JOBSUCHE").
 *  - CORS offen, verify_jwt=false (public data)
 *
 * API: https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs
 *   Header: X-API-Key: jobboerse-jobsuche  (öffentlich, keyless dokumentiert)
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface ArbeitsmarktRequest {
  was?: string;       // Berufsbezeichnung / Stichwort (Pflicht)
  wo?: string;        // Ort, PLZ oder Region
  umkreis?: number;   // km (0,10,25,50,100,200)
  size?: number;      // max 50
  page?: number;      // 1-basiert
  angebotsart?: number; // 1=ARBEIT, 2=SELBSTSTAENDIG, 4=AUSBILDUNG/DUALES STUDIUM
}

interface JobItem {
  source: "BA_JOBSUCHE";
  refnr: string;
  titel: string;
  beruf: string | null;
  arbeitgeber: string | null;
  plz: string | null;
  ort: string | null;
  region: string | null;
  eintrittsdatum: string | null;
  veroeffentlicht: string | null;
  modifiziert: string | null;
  externe_url: string | null;
  detail_url: string;
}

interface Aggregation {
  total: number;
  page: number;
  size: number;
  top_arbeitgeber: { name: string; count: number }[];
  top_orte: { name: string; count: number }[];
  trend: { last_7_days: number; last_14_days: number; last_30_days: number };
}

interface ArbeitsmarktResponse {
  query: ArbeitsmarktRequest;
  fetched_at: string;
  source: "Bundesagentur für Arbeit — Jobsuche v4 (bund.dev)";
  jobs: JobItem[];
  aggregation: Aggregation;
  errors: { message: string }[];
}

const BA_BASE = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs";
const BA_KEY = "jobboerse-jobsuche";

const CACHE = new Map<string, { at: number; data: ArbeitsmarktResponse }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(q: ArbeitsmarktRequest): string {
  return JSON.stringify({
    was: (q.was ?? "").trim().toLowerCase(),
    wo: (q.wo ?? "").trim().toLowerCase(),
    umkreis: q.umkreis ?? 0,
    size: q.size ?? 25,
    page: q.page ?? 1,
    angebotsart: q.angebotsart ?? null,
  });
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function topN(items: (string | null | undefined)[], n: number) {
  const m = new Map<string, number>();
  for (const raw of items) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    m.set(name, (m.get(name) ?? 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

async function fetchJobs(q: ArbeitsmarktRequest): Promise<ArbeitsmarktResponse> {
  const size = Math.min(Math.max(q.size ?? 25, 1), 50);
  const page = Math.max(q.page ?? 1, 1);
  const params = new URLSearchParams();
  if (q.was) params.set("was", q.was);
  if (q.wo) params.set("wo", q.wo);
  if (q.umkreis && q.umkreis > 0) params.set("umkreis", String(q.umkreis));
  if (q.angebotsart) params.set("angebotsart", String(q.angebotsart));
  params.set("size", String(size));
  params.set("page", String(page));

  const url = `${BA_BASE}?${params.toString()}`;
  const errors: { message: string }[] = [];
  let jobs: JobItem[] = [];
  let total = 0;

  try {
    const res = await fetch(url, { headers: { "X-API-Key": BA_KEY, "Accept": "application/json" } });
    if (!res.ok) {
      errors.push({ message: `BA Jobsuche HTTP ${res.status}` });
    } else {
      const json = await res.json();
      total = Number(json?.maxErgebnisse ?? json?.facetten?.beruf?.maxCount ?? json?.stellenangebote?.length ?? 0);
      const raw: any[] = Array.isArray(json?.stellenangebote) ? json.stellenangebote : [];
      jobs = raw.map((j) => ({
        source: "BA_JOBSUCHE" as const,
        refnr: String(j?.refnr ?? ""),
        titel: String(j?.titel ?? ""),
        beruf: j?.beruf ?? null,
        arbeitgeber: j?.arbeitgeber ?? null,
        plz: j?.arbeitsort?.plz ?? null,
        ort: j?.arbeitsort?.ort ?? null,
        region: j?.arbeitsort?.region ?? null,
        eintrittsdatum: j?.eintrittsdatum ?? null,
        veroeffentlicht: j?.aktuelleVeroeffentlichungsdatum ?? null,
        modifiziert: j?.modifikationsTimestamp ?? null,
        externe_url: j?.externeUrl ?? null,
        detail_url: `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(j?.refnr ?? "")}`,
      }));
    }
  } catch (e) {
    errors.push({ message: `BA Jobsuche fetch failed: ${(e as Error).message}` });
  }

  const last7 = jobs.filter((j) => (daysSince(j.veroeffentlicht) ?? 99) <= 7).length;
  const last14 = jobs.filter((j) => (daysSince(j.veroeffentlicht) ?? 99) <= 14).length;
  const last30 = jobs.filter((j) => (daysSince(j.veroeffentlicht) ?? 99) <= 30).length;

  return {
    query: { ...q, size, page },
    fetched_at: new Date().toISOString(),
    source: "Bundesagentur für Arbeit — Jobsuche v4 (bund.dev)",
    jobs,
    aggregation: {
      total,
      page,
      size,
      top_arbeitgeber: topN(jobs.map((j) => j.arbeitgeber), 8),
      top_orte: topN(jobs.map((j) => j.ort), 8),
      trend: { last_7_days: last7, last_14_days: last14, last_30_days: last30 },
    },
    errors,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let body: ArbeitsmarktRequest = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    } else {
      const u = new URL(req.url);
      body = {
        was: u.searchParams.get("was") ?? undefined,
        wo: u.searchParams.get("wo") ?? undefined,
        umkreis: u.searchParams.get("umkreis") ? Number(u.searchParams.get("umkreis")) : undefined,
        size: u.searchParams.get("size") ? Number(u.searchParams.get("size")) : undefined,
        page: u.searchParams.get("page") ? Number(u.searchParams.get("page")) : undefined,
        angebotsart: u.searchParams.get("angebotsart") ? Number(u.searchParams.get("angebotsart")) : undefined,
      };
    }

    if (!body.was || body.was.trim().length < 2) {
      return new Response(JSON.stringify({ error: "Parameter 'was' (Berufsbezeichnung) ist Pflicht (min 2 Zeichen)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const key = cacheKey(body);
    const cached = CACHE.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return new Response(JSON.stringify({ ...cached.data, _cache: "hit" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await fetchJobs(body);
    CACHE.set(key, { at: Date.now(), data });

    return new Response(JSON.stringify({ ...data, _cache: "miss" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
