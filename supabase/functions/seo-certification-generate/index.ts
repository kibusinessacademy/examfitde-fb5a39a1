import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { calculateHybridTarget } from "../_shared/hybridExamTarget.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const PAGE_TYPES = [
  "landing",
  "pruefungsstruktur",
  "durchfallquote",
  "schweregrad",
  "faq",
  "simulation",
] as const;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

interface CatalogEntry {
  id: string;
  title: string;
  slug: string;
  catalog_type: string;
  chamber_type: string;
  track: string;
  exam_format: Record<string, boolean>;
  min_question_target: number;
  exam_complexity_score: number;
  math_ratio: number;
  oral_component: boolean;
  learning_field_count: number;
  certification_level: string;
}

function buildMetaTitle(cert: CatalogEntry, pageType: string): string {
  const target = calculateHybridTarget({
    durationMonths: null,
    track: cert.track,
    examComplexityScore: cert.exam_complexity_score,
    mathRatio: cert.math_ratio,
    oralComponent: cert.oral_component,
    learningFieldCount: cert.learning_field_count,
    certificationLevel: cert.certification_level,
  });

  const templates: Record<string, string> = {
    landing: `${cert.title} Prüfungstrainer 2026 – ${target.label} Fragen | ExamFit`,
    pruefungsstruktur: `${cert.title} Prüfungsstruktur & Gewichtung 2026 | ExamFit`,
    durchfallquote: `${cert.title} Durchfallquote & Bestehensstrategien | ExamFit`,
    schweregrad: `${cert.title} Schwierigkeitsanalyse | ExamFit`,
    faq: `${cert.title} Prüfung FAQ – Häufige Fragen | ExamFit`,
    simulation: `${cert.title} Prüfungssimulation online | ExamFit`,
  };
  return templates[pageType] || `${cert.title} | ExamFit`;
}

function buildMetaDescription(cert: CatalogEntry, pageType: string): string {
  const target = calculateHybridTarget({
    durationMonths: null,
    track: cert.track,
    examComplexityScore: cert.exam_complexity_score,
    mathRatio: cert.math_ratio,
    oralComponent: cert.oral_component,
    learningFieldCount: cert.learning_field_count,
    certificationLevel: cert.certification_level,
  });

  const templates: Record<string, string> = {
    landing: `Bestehe die ${cert.title}-Prüfung sicher mit ${target.label} originalgetreuen Prüfungsfragen, KI-Simulation & mündlicher Vorbereitung. 100% Rahmenplan-Coverage.`,
    pruefungsstruktur: `Komplette Prüfungsstruktur der ${cert.title}-Prüfung: Gewichtung, Teile, Themen & Bewertung. Optimiere deine Vorbereitung mit ExamFit.`,
    durchfallquote: `Aktuelle Durchfallquote der ${cert.title}-Prüfung und bewährte Strategien zum Bestehen. Datenbasierte Analyse mit ExamFit.`,
    schweregrad: `Schwierigkeitsanalyse der ${cert.title}-Prüfung: Welche Themen sind am schwersten? KI-basierte Auswertung und Lernempfehlungen.`,
    faq: `Die häufigsten Fragen zur ${cert.title}-Prüfung: Ablauf, Kosten, Vorbereitung, Wiederholung und mehr.`,
    simulation: `Realistische ${cert.title}-Prüfungssimulation mit ${target.label} Fragen. IHK-konformer Ablauf, Zeitdruck und Auswertung.`,
  };
  return templates[pageType] || `${cert.title} Prüfungsvorbereitung mit ExamFit.`;
}

function buildSlug(cert: CatalogEntry, pageType: string): string {
  const base = cert.slug || slugify(cert.title);
  const suffixes: Record<string, string> = {
    landing: `${base}-pruefung`,
    pruefungsstruktur: `${base}-pruefungsstruktur`,
    durchfallquote: `${base}-durchfallquote`,
    schweregrad: `${base}-schweregrad`,
    faq: `${base}-faq`,
    simulation: `${base}-pruefungssimulation`,
  };
  return suffixes[pageType] || base;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({}));
  const certId: string | null = body.certification_catalog_id || null;
  const pageTypes: string[] = body.page_types || [...PAGE_TYPES];

  try {
    // Fetch certifications to generate pages for
    let query = sb.from("certification_catalog").select("*");
    if (certId) {
      query = query.eq("id", certId);
    }
    const { data: certs, error: certErr } = await query;
    if (certErr) throw certErr;
    if (!certs?.length) return json({ ok: false, error: "No certifications found" }, 404);

    let pagesCreated = 0;
    let pagesUpdated = 0;
    const errors: string[] = [];

    for (const cert of certs as CatalogEntry[]) {
      for (const pageType of pageTypes) {
        const slug = buildSlug(cert, pageType);
        const metaTitle = buildMetaTitle(cert, pageType);
        const metaDescription = buildMetaDescription(cert, pageType);
        const title = metaTitle.replace(/ \| ExamFit$/, "");

        // Upsert
        const { data: existing } = await sb
          .from("certification_seo_pages")
          .select("id")
          .eq("certification_catalog_id", cert.id)
          .eq("page_type", pageType)
          .maybeSingle();

        // Find related certs for internal linking
        const { data: related } = await sb
          .from("certification_catalog")
          .select("slug, title")
          .neq("id", cert.id)
          .eq("certification_level", cert.certification_level)
          .limit(6);

        const internalLinks = (related || []).map(r => ({
          slug: buildSlug(r as CatalogEntry, "landing"),
          title: (r as { title: string }).title,
        }));

        const pageData = {
          certification_catalog_id: cert.id,
          page_type: pageType,
          slug,
          title,
          meta_title: metaTitle,
          meta_description: metaDescription,
          internal_links: internalLinks,
          is_published: true,
          published_at: new Date().toISOString(),
        };

        if (existing) {
          const { error } = await sb
            .from("certification_seo_pages")
            .update(pageData)
            .eq("id", existing.id);
          if (error) errors.push(`Update ${slug}: ${error.message}`);
          else pagesUpdated++;
        } else {
          const { error } = await sb
            .from("certification_seo_pages")
            .insert(pageData);
          if (error) errors.push(`Insert ${slug}: ${error.message}`);
          else pagesCreated++;
        }
      }
    }

    return json({
      ok: true,
      certifications_processed: certs.length,
      pages_created: pagesCreated,
      pages_updated: pagesUpdated,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[seo-certification-generate] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
