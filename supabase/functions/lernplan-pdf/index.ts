/**
 * lernplan-pdf — generiert ECHTES PDF (application/pdf) für einen Lernplan.
 *
 * Phase 2.5 final:
 *  - Server-side rendering via jspdf (esm.sh) — kein Headless-Browser nötig
 *  - Liefert { ok, url }  mit data:application/pdf;base64,…
 *  - verify_jwt = false (anon erlaubt)
 *  - Bei Fehlern strukturierte JSON-Antwort, damit Frontend Retry zeigen kann.
 */
// @ts-ignore esm.sh
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";

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

const PLANS: Record<
  string,
  { title: string; bundleSlug: string; weeks: PlanWeek[] }
> = {
  "aevo-pruefungsreife": {
    title: "AEVO – 4-Wochen-Lernplan zur Prüfungsreife",
    bundleSlug: "ausbildereignungspruefung-aevo",
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
        focus: "Handlungsfeld 1 & 2: Voraussetzungen, Vorbereitung",
        tasks: [
          "Ausbildungsplan-Vorlage selbst erstellen",
          "Eignung Ausbilder/Betrieb wiederholen",
          "Übung: Probezeit & Kündigung",
        ],
      },
      {
        week: 3,
        focus: "Handlungsfeld 3: Durchführung — Methodik",
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
          "Praktische Präsentation üben + Fachgespräch",
          "AI-Tutor: 3 mündliche Prüfungssimulationen",
        ],
      },
    ],
  },
};

function buildPdf(slug: string, plan: typeof PLANS[string]): string {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = margin;

  // Header
  doc.setTextColor(13, 148, 136); // teal-600
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(plan.title, margin, y);
  y += 24;

  doc.setTextColor(100, 116, 139);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Erzeugt am ${new Date().toLocaleDateString("de-DE")} · ExamFit`,
    margin,
    y
  );
  y += 24;

  // Wochen
  for (const w of plan.weeks) {
    if (y > 720) {
      doc.addPage();
      y = margin;
    }
    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, pageW - 2 * margin, 24, 4, 4, "FD");

    doc.setTextColor(19, 78, 74);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`Woche ${w.week}: ${w.focus}`, margin + 10, y + 16);
    y += 36;

    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    for (const t of w.tasks) {
      if (y > 760) {
        doc.addPage();
        y = margin;
      }
      const lines = doc.splitTextToSize(`•  ${t}`, pageW - 2 * margin - 14);
      doc.text(lines, margin + 14, y);
      y += lines.length * 14 + 2;
    }
    y += 10;
  }

  // CTA-Box
  if (y > 700) {
    doc.addPage();
    y = margin;
  }
  doc.setFillColor(240, 253, 250);
  doc.setDrawColor(94, 234, 212);
  doc.roundedRect(margin, y, pageW - 2 * margin, 60, 6, 6, "FD");
  doc.setTextColor(13, 148, 136);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Komplett-Bundle (24,90 €)", margin + 12, y + 18);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "normal");
  doc.text(
    "Lernkurs · Prüfungstrainer · AI-Tutor · mündliche Simulation",
    margin + 12,
    y + 34
  );
  doc.setTextColor(13, 148, 136);
  doc.text(`https://examfit.de/bundle/${plan.bundleSlug}`, margin + 12, y + 50);

  // Footer
  const pageH = doc.internal.pageSize.getHeight();
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.text(
    `© ExamFit · Persönlicher Lernplan · slug=${slug}`,
    margin,
    pageH - 24
  );

  // Datauri
  const base64 = doc.output("datauristring");
  // jsPDF gibt vollen "data:application/pdf;filename=…;base64,…" zurück
  return base64;
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

    const dataUrl = buildPdf(slug, plan);

    return new Response(
      JSON.stringify({ ok: true, url: dataUrl, mime: "application/pdf" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[lernplan-pdf] failed:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: (err as Error).message ?? "render_failed",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
