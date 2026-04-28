/**
 * lernplan-pdf — Generates a printable HTML response for a lernplan slug.
 *
 * Phase 2.5: Server-side renders deterministic HTML with print-styles.
 * The browser triggers `window.print()` to save as PDF — keeps zero new
 * dependencies (no Puppeteer). Endpoint is verify_jwt = false (anon allowed).
 *
 * Returns JSON { url: <data-url> } so the existing frontend `data.url`
 * branch in LernplanPage continues to work without changes.
 */
// Lokale CORS-Headers — kein SDK-Import (in Edge-Runtime nicht verlässlich verfügbar).
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PlanWeek {
  week: number;
  focus: string;
  tasks: string[];
}

const PLANS: Record<string, { title: string; weeks: PlanWeek[] }> = {
  "aevo-pruefungsreife": {
    title: "AEVO – Dein 4-Wochen-Lernplan zur Prüfungsreife",
    weeks: [
      {
        week: 1,
        focus: "Grundlagen & Recht (BBiG, JArbSchG, AusbVO)",
        tasks: [
          "Lernkarten Recht durcharbeiten (60 Min)",
          "10 Multiple-Choice-Fragen Recht (Trainer)",
          "Mini-Check: Mindestinhalte Ausbildungsvertrag",
        ],
      },
      {
        week: 2,
        focus: "Handlungsfeld 1 & 2: Voraussetzungen prüfen, Ausbildung vorbereiten",
        tasks: [
          "Ausbildungsplan-Vorlage selbst erstellen",
          "Eignung Ausbilder/Betrieb wiederholen",
          "Übung: Probezeit & Kündigung",
        ],
      },
      {
        week: 3,
        focus: "Handlungsfeld 3: Ausbildung durchführen — Methodik",
        tasks: [
          "Vier-Stufen-Methode in eigenen Worten erklären",
          "Lehrgespräch vs. Lernauftrag vergleichen",
          "Praktische Unterweisung (15 Min) skizzieren",
        ],
      },
      {
        week: 4,
        focus: "Prüfungssimulation",
        tasks: [
          "Schriftliche Probeprüfung (180 Min) komplett",
          "Praktische Präsentation üben (15 Min) + Fachgespräch (15 Min)",
          "AI-Tutor: 3 mündliche Prüfungssimulationen",
        ],
      },
    ],
  },
};

function renderHtml(slug: string, plan: { title: string; weeks: PlanWeek[] }): string {
  const weeksHtml = plan.weeks
    .map(
      (w) => `
        <section class="week">
          <h2>Woche ${w.week}: ${escapeHtml(w.focus)}</h2>
          <ul>${w.tasks.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
        </section>`
    )
    .join("");

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(plan.title)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.5; }
    h1 { font-size: 22pt; margin: 0 0 4pt 0; color: #0d9488; }
    h2 { font-size: 13pt; margin: 0 0 6pt 0; color: #134e4a; }
    .meta { color: #64748b; font-size: 10pt; margin-bottom: 16pt; }
    .week { border: 1pt solid #cbd5e1; border-radius: 6pt; padding: 10pt 12pt; margin-bottom: 8pt; break-inside: avoid; }
    ul { margin: 4pt 0 0 18pt; padding: 0; }
    li { margin-bottom: 3pt; }
    footer { margin-top: 16pt; color: #64748b; font-size: 9pt; text-align: center; }
    .cta { margin-top: 14pt; padding: 10pt 12pt; background: #f0fdfa; border: 1pt solid #5eead4; border-radius: 6pt; }
  </style>
</head>
<body onload="window.print()">
  <h1>${escapeHtml(plan.title)}</h1>
  <p class="meta">Slug: ${escapeHtml(slug)} · Erzeugt am ${new Date().toLocaleDateString("de-DE")}</p>
  ${weeksHtml}
  <div class="cta">
    <strong>Jetzt umsetzen mit dem Komplett-Bundle (24,90 €):</strong>
    Lernkurs · Prüfungstrainer · AI-Tutor · Mündliche Simulation.<br />
    https://examfit.de/bundle/ausbildereignungspruefung-aevo
  </div>
  <footer>© ExamFit · Dein persönlicher Lernplan</footer>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body?.slug ?? "");
    const plan = PLANS[slug];
    if (!plan) {
      return new Response(
        JSON.stringify({ ok: false, error: "unknown_slug" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const html = renderHtml(slug, plan);
    const dataUrl = `data:text/html;charset=utf-8;base64,${btoa(unescape(encodeURIComponent(html)))}`;

    return new Response(JSON.stringify({ ok: true, url: dataUrl }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message ?? "render_failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
