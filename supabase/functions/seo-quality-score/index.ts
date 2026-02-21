// supabase/functions/seo-quality-score/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Input = {
  slug?: string;         // z.B. "/pruefungstraining-azubis"
  page_id?: string;      // optional: UUID
};

type PageRow = {
  id?: string;
  slug?: string;
  title?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  h1?: string | null;
  canonical_url?: string | null;
  content?: string | null; // markdown/html/text
  updated_at?: string | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

function norm(s?: string | null) {
  return (s ?? "").trim();
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function scoreRange(len: number, min: number, max: number, full: number) {
  if (len === 0) return 0;
  if (len >= min && len <= max) return full;
  // linear penalty outside range
  const dist = len < min ? (min - len) : (len - max);
  return clamp(full - dist, Math.floor(full * 0.3), full);
}

function computeQuality(page: PageRow) {
  const title = norm(page.meta_title) || norm(page.title);
  const desc = norm(page.meta_description);
  const h1 = norm(page.h1);
  const canonical = norm(page.canonical_url);
  const content = norm(page.content);

  const titleLen = title.length;
  const descLen = desc.length;
  const contentWords = content ? content.split(/\s+/).filter(Boolean).length : 0;

  // Gewichtung (einfach + praxistauglich, später feinjustieren)
  const WEIGHTS = {
    title: 25,
    description: 20,
    h1: 15,
    canonical: 10,
    content: 20,
    freshness: 10,
  };

  const points: Record<string, number> = {
    title: scoreRange(titleLen, 30, 60, WEIGHTS.title),
    description: scoreRange(descLen, 120, 160, WEIGHTS.description),
    h1: h1 ? WEIGHTS.h1 : 0,
    canonical: canonical ? WEIGHTS.canonical : 0,
    content: clamp(Math.floor((contentWords / 600) * WEIGHTS.content), 0, WEIGHTS.content),
    freshness: 0,
  };

  // Freshness: voll, wenn innerhalb 90 Tage aktualisiert
  if (page.updated_at) {
    const updated = new Date(page.updated_at).getTime();
    const ageDays = (Date.now() - updated) / (1000 * 60 * 60 * 24);
    points.freshness = ageDays <= 90 ? WEIGHTS.freshness : ageDays <= 180 ? Math.floor(WEIGHTS.freshness * 0.6) : Math.floor(WEIGHTS.freshness * 0.3);
  } else {
    points.freshness = Math.floor(WEIGHTS.freshness * 0.3);
  }

  const total = Object.values(points).reduce((a, b) => a + b, 0);

  const issues: Array<{ key: string; message: string; severity: "low" | "medium" | "high" }> = [];

  if (!title) issues.push({ key: "title_missing", message: "Meta-Titel fehlt.", severity: "high" });
  else if (titleLen < 30) issues.push({ key: "title_short", message: "Meta-Titel ist zu kurz (< 30 Zeichen).", severity: "medium" });
  else if (titleLen > 60) issues.push({ key: "title_long", message: "Meta-Titel ist zu lang (> 60 Zeichen).", severity: "medium" });

  if (!desc) issues.push({ key: "desc_missing", message: "Meta-Description fehlt.", severity: "high" });
  else if (descLen < 120) issues.push({ key: "desc_short", message: "Meta-Description ist zu kurz (< 120 Zeichen).", severity: "medium" });
  else if (descLen > 160) issues.push({ key: "desc_long", message: "Meta-Description ist zu lang (> 160 Zeichen).", severity: "medium" });

  if (!h1) issues.push({ key: "h1_missing", message: "H1 fehlt.", severity: "high" });
  if (!canonical) issues.push({ key: "canonical_missing", message: "Canonical URL fehlt.", severity: "low" });

  if (contentWords < 300) issues.push({ key: "content_thin", message: "Content wirkt dünn (< 300 Wörter).", severity: "medium" });

  // simple grade
  const grade = total >= 85 ? "A" : total >= 70 ? "B" : total >= 55 ? "C" : total >= 40 ? "D" : "E";

  return {
    score: clamp(total, 0, 100),
    grade,
    breakdown: points,
    metrics: { titleLen, descLen, contentWords },
    issues,
    recommended_next_steps: issues.slice(0, 5).map(i => i.message),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env." }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const body = (await req.json().catch(() => ({}))) as Input;

    // Du kannst hier Auth erzwingen, wenn es Admin-only sein soll:
    // const authHeader = req.headers.get("Authorization") ?? "";
    // if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const slug = body.slug?.trim();
    const pageId = body.page_id?.trim();

    // ✅ SSOT: Wir lesen serverseitig aus DB.
    // WICHTIG: Passe hier die Tabelle/Spalten an dein reales Schema an.
    // Default: "seo_pages" mit Feldern wie slug, meta_title, meta_description, h1, canonical_url, content, updated_at.
    let query = supabase.from("seo_pages").select("*").limit(1);

    if (pageId) query = query.eq("id", pageId);
    else if (slug) query = query.eq("slug", slug);
    else return json({ error: "Provide slug or page_id" }, 400);

    const { data, error } = await query.single();
    if (error) {
      return json({
        error: "DB query failed",
        details: error.message,
        hint: "Falls deine Tabelle nicht 'seo_pages' heißt, passe den Namen in der Function an.",
      }, 500);
    }

    const page = data as PageRow;

    const result = computeQuality(page);

    return json({
      ok: true,
      input: { slug: slug ?? null, page_id: pageId ?? null },
      page: {
        id: page.id ?? null,
        slug: page.slug ?? slug ?? null,
        updated_at: page.updated_at ?? null,
      },
      result,
    });
  } catch (e) {
    return json({ error: "Unhandled error", details: String(e?.message ?? e) }, 500);
  }
});
