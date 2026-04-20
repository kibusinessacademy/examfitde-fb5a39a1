/**
 * package-auto-generate-seo-suite
 * ────────────────────────────────────────────────────────────────────────────
 * Job-Type:  package_auto_generate_seo_suite
 * Lane:      marketing
 * Trigger:   trg_post_publish_seo_suite (course_packages.status → 'published')
 *
 * Zweck:
 *   Orchestriert die SEO-Suite für ein veröffentlichtes course_package:
 *     1. Resolves package_id → certification_id (SSOT-Kette)
 *     2. Delegiert an existierende `seo-content-factory` (DRY) → 7 SEO-Pages
 *     3. Materialisiert `seo_content_pages` (Track-Persona-Landing) als
 *        zusätzlichen Conversion-Layer
 *     4. Schreibt admin_notification + cleant Job-Status
 *
 * Idempotenz:
 *   - seo-content-factory skippt vorhandene Dokumente (titel-match)
 *   - seo_content_pages: UPSERT auf (package_id, page_type, persona_type)
 *   - Job-Run schreibt result-Summary, max_attempts=3
 *
 * SSOT-Konformität:
 *   - Keine Frontend-Logik
 *   - Keine Shadow-Tabellen
 *   - Nutzt existierende Templates aus seo_templates
 *   - Schreibt ausschließlich in dokumentierte Marketing-Tabellen
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const JOB_TYPE = "package_auto_generate_seo_suite";

interface JobPayload {
  package_id: string;
  curriculum_id?: string | null;
  track?: string | null;
  reason?: string | null;
}

interface SuiteResult {
  package_id: string;
  certification_id: string | null;
  seo_documents_triggered: number;
  seo_documents_errors: string[];
  seo_content_pages_upserted: number;
  duration_ms: number;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const { job_id, payload: directPayload, dry_run = false } = body as {
      job_id?: string;
      payload?: JobPayload;
      dry_run?: boolean;
    };

    // ──────────────────────────────────────────────────────────────
    // Modus 1: Job-Worker (claim by job_id, vom Scheduler aufgerufen)
    // Modus 2: Direkt-Invocation mit payload (für Tests / Backfills)
    // ──────────────────────────────────────────────────────────────
    let jobId: string | null = job_id ?? null;
    let payload: JobPayload | null = directPayload ?? null;

    if (jobId && !payload) {
      const { data: job, error: jobErr } = await sb
        .from("job_queue")
        .select("id, payload, status, attempts, max_attempts")
        .eq("id", jobId)
        .single();

      if (jobErr || !job) {
        return json({ error: `job_not_found: ${jobId}` }, 404, headers);
      }
      if (job.status === "completed") {
        return json({ ok: true, skipped: "already_completed", job_id: jobId }, 200, headers);
      }
      payload = job.payload as JobPayload;

      // Mark processing
      if (!dry_run) {
        await sb.from("job_queue")
          .update({
            status: "processing",
            started_at: new Date().toISOString(),
            attempts: (job.attempts ?? 0) + 1,
            locked_by: "package-auto-generate-seo-suite",
            locked_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      }
    }

    if (!payload?.package_id) {
      return json({ error: "package_id required in payload" }, 400, headers);
    }

    const startedAt = Date.now();

    // ──────────────────────────────────────────────────────────────
    // 1. Resolve SSOT-Kette: package → certification
    // ──────────────────────────────────────────────────────────────
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages")
      .select("id, certification_id, curriculum_id, title, track, status")
      .eq("id", payload.package_id)
      .single();

    if (pkgErr || !pkg) {
      await failJob(sb, jobId, `package_not_found: ${payload.package_id}`, true);
      return json({ error: "package_not_found", package_id: payload.package_id }, 404, headers);
    }

    if (pkg.status !== "published") {
      // Defensive: nur veröffentlichte Pakete bekommen SEO-Suite
      await completeJob(sb, jobId, {
        skipped: "package_not_published",
        status: pkg.status,
      });
      return json({ ok: true, skipped: "package_not_published" }, 200, headers);
    }

    if (!pkg.certification_id) {
      await failJob(sb, jobId, `package_missing_certification_id`, true);
      return json({ error: "package_missing_certification_id" }, 422, headers);
    }

    // ──────────────────────────────────────────────────────────────
    // 2. Delegate an seo-content-factory (DRY: 7-Page-Set wird dort erzeugt)
    // ──────────────────────────────────────────────────────────────
    const factoryUrl = `${supabaseUrl}/functions/v1/seo-content-factory`;
    const factoryResp = await fetch(factoryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        mode: "single",
        certification_id: pkg.certification_id,
      }),
    });

    let factoryResult: any = null;
    let factoryTriggered = 0;
    let factoryErrors: string[] = [];
    try {
      factoryResult = await factoryResp.json();
      const r0 = factoryResult?.results?.[0];
      factoryTriggered = r0?.triggered ?? 0;
      factoryErrors = r0?.errors ?? [];
    } catch (_e) {
      factoryErrors.push(`factory_response_unparseable: ${factoryResp.status}`);
    }

    // ──────────────────────────────────────────────────────────────
    // 3. Materialize seo_content_pages (Persona-Landings pro Track)
    //    Diese Tabelle wird NICHT von der factory bedient → eigene Logik.
    // ──────────────────────────────────────────────────────────────
    const personaPages = buildPersonaPages(pkg);
    let upserted = 0;
    for (const page of personaPages) {
      const { error: upErr } = await sb
        .from("seo_content_pages")
        .upsert(page, { onConflict: "package_id,page_type,persona_type" });
      if (!upErr) upserted++;
    }

    // ──────────────────────────────────────────────────────────────
    // 4. Result, Notification, Job complete
    // ──────────────────────────────────────────────────────────────
    const result: SuiteResult = {
      package_id: pkg.id,
      certification_id: pkg.certification_id,
      seo_documents_triggered: factoryTriggered,
      seo_documents_errors: factoryErrors,
      seo_content_pages_upserted: upserted,
      duration_ms: Date.now() - startedAt,
    };

    await sb.from("admin_notifications").insert({
      title: factoryErrors.length > 0
        ? "⚠️ Auto-SEO-Suite mit Fehlern abgeschlossen"
        : "✅ Auto-SEO-Suite abgeschlossen",
      body: `Paket "${pkg.title}": ${factoryTriggered} SEO-Docs + ${upserted} Persona-Pages. ${factoryErrors.length} Fehler.`,
      severity: factoryErrors.length > 0 ? "warning" : "info",
      category: "marketing",
      entity_type: "course_package",
      entity_id: pkg.id,
      metadata: result,
    });

    if (!dry_run) {
      await completeJob(sb, jobId, result);
    }

    return json({ ok: true, result }, 200, headers);
  } catch (error) {
    console.error("[package-auto-generate-seo-suite] FATAL:", error);
    const msg = error instanceof Error ? error.message : "unknown_error";
    return json({ error: msg }, 500, headers);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function completeJob(
  sb: ReturnType<typeof createClient>,
  jobId: string | null,
  result: unknown,
) {
  if (!jobId) return;
  await sb.from("job_queue")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      result: result as any,
      locked_by: null,
      locked_at: null,
      last_error: null,
    })
    .eq("id", jobId);
}

async function failJob(
  sb: ReturnType<typeof createClient>,
  jobId: string | null,
  reason: string,
  permanent: boolean,
) {
  if (!jobId) return;
  await sb.from("job_queue")
    .update({
      status: permanent ? "failed" : "pending",
      last_error: reason,
      last_error_class: permanent ? "permanent" : "transient",
      locked_by: null,
      locked_at: null,
    } as any)
    .eq("id", jobId);
}

/**
 * Persona-Pages: Pro Track werden Conversion-optimierte Landingpages
 * für die Hauptzielgruppen erzeugt. Diese ergänzen die generischen
 * SEO-Dokumente um persona-spezifische Funnels.
 */
function buildPersonaPages(pkg: {
  id: string;
  curriculum_id: string | null;
  title: string;
  track: string | null;
}) {
  const baseSlug = slugify(pkg.title);
  const personas = personasForTrack(pkg.track);

  return personas.map((persona) => ({
    package_id: pkg.id,
    curriculum_id: pkg.curriculum_id,
    page_type: "persona_landing",
    target_audience: persona.audience,
    persona_type: persona.key,
    slug: `pruefungstraining/${baseSlug}/${persona.key}`,
    title: `${pkg.title} – ${persona.headline}`,
    meta_description: persona.metaDescription(pkg.title),
    content_md: persona.contentTemplate(pkg.title),
    faq_json: persona.faqs(pkg.title),
    status: "draft", // Editor-Review vor Publish
  }));
}

function personasForTrack(track: string | null) {
  const t = (track ?? "EXAM_FIRST").toUpperCase();

  const azubi = {
    key: "azubi",
    audience: "Auszubildende",
    headline: "Prüfungsvorbereitung für Azubis",
    metaDescription: (title: string) =>
      `${title} bestehen: Strukturierte Prüfungsvorbereitung für Azubis mit AI-Tutor, Musterfragen und Simulationen. Jetzt starten.`,
    contentTemplate: (title: string) =>
      `# ${title} – Prüfungstraining für Azubis\n\nDu willst die ${title}-Prüfung sicher bestehen? Unser KI-gestütztes Training bereitet dich gezielt vor:\n\n- Echte Prüfungssimulationen\n- Persönlicher AI-Tutor\n- Lernfeld-genaue Musterfragen\n\n## So funktioniert's\n1. Diagnostik-Test\n2. Adaptiver Lernplan\n3. Prüfungssimulation\n\n[Jetzt starten →](/pruefungstraining)`,
    faqs: (title: string) => ({
      items: [
        { q: `Wie lange dauert die Vorbereitung auf ${title}?`, a: "8–12 Wochen mit täglich 30 Minuten reichen für ein solides Bestehen." },
        { q: "Sind die Fragen prüfungsnah?", a: "Ja, alle Fragen sind an das offizielle Prüfungs-Format angelehnt und nach Lernfeldern strukturiert." },
        { q: "Brauche ich Vorkenntnisse?", a: "Nein, der adaptive Lernplan startet bei deinem aktuellen Wissensstand." },
      ],
    }),
  };

  const umschuelung = {
    key: "umschulung",
    audience: "Umschüler & Quereinsteiger",
    headline: "Prüfungsvorbereitung für Umschüler",
    metaDescription: (title: string) =>
      `${title} als Umschüler bestehen: Kompakter Online-Kurs mit Prüfungssimulationen, AI-Tutor und Lernpfad. Jetzt informieren.`,
    contentTemplate: (title: string) =>
      `# ${title} – Umschulung & Quereinstieg\n\nNach Umschulung oder Quereinstieg sicher in die ${title}-Prüfung. Wir bringen dich auf das Niveau, das die IHK erwartet.\n\n- Kompakter Lernpfad\n- 24/7 AI-Tutor\n- Prüfungssimulationen\n\n[Kostenlos testen →](/pruefungstraining)`,
    faqs: (title: string) => ({
      items: [
        { q: `Reicht der Kurs für die ${title}-Prüfung als Umschüler?`, a: "Ja, der Lernpfad deckt alle prüfungsrelevanten Lernfelder vollständig ab." },
        { q: "Kann ich neben dem Job lernen?", a: "Ja, das Training ist asynchron und mobil verfügbar." },
      ],
    }),
  };

  const betrieb = {
    key: "betrieb",
    audience: "Ausbildungsbetriebe",
    headline: "Prüfungsvorbereitung für Ihre Azubis",
    metaDescription: (title: string) =>
      `${title}-Prüfungsvorbereitung für Ausbildungsbetriebe: Höhere Bestehensquoten, weniger Aufwand, klare Lernfortschritte. Jetzt anfragen.`,
    contentTemplate: (title: string) =>
      `# ${title} – Lösung für Ausbildungsbetriebe\n\nSichern Sie die Bestehensquote Ihrer Azubis in der ${title}-Prüfung. Mit Reporting, Lernfortschritt und AI-gestützten Coachings.\n\n- Multi-Azubi-Verwaltung\n- Lernfortschritts-Reporting\n- IHK-konforme Inhalte\n\n[Demo anfragen →](/business)`,
    faqs: (_title: string) => ({
      items: [
        { q: "Wie viele Azubis kann ich verwalten?", a: "Beliebig viele – Sie zahlen pro aktivem Lerner." },
        { q: "Erhalte ich Lernreports?", a: "Ja, monatliche Reports mit individuellem Lernfortschritt." },
      ],
    }),
  };

  if (t === "STUDIUM") return [azubi, umschuelung]; // Ohne Betrieb-Persona
  if (t === "AUSBILDUNG_VOLL") return [azubi, betrieb];
  return [azubi, umschuelung, betrieb]; // EXAM_FIRST / EXAM_FIRST_PLUS
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
