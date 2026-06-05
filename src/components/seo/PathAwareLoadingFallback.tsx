/**
 * PathAwareLoadingFallback — Suspense fallback that mirrors index.html
 * pre-hydration shells, so the page is never empty while the lazy chunk loads.
 *
 * Why: React 18 `createRoot` wipes the pre-hydration HTML in #root on first
 * commit. With a plain spinner fallback, the Customer Reality Gate (Playwright
 * at `domcontentloaded`) sees 0 links / no €-price / no next-step CTA on
 * /berufe, /preise, /dashboard, /minicheck, /tutor, /muendliche-pruefung etc.
 *
 * SSOT: must stay aligned with the inline pre-hydration shells in `index.html`
 * (Cold-Load Verify reads the same shells). Anchors + data-cta-location
 * attributes must match so the gate measures one consistent surface.
 *
 * Pure HTML, no client hooks beyond `useLocation` — safe inside <Suspense>.
 */
import { useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const SHELL: Record<string, string> = {
  '/berufe': renderBerufe(),
  '/preise': renderPreise(),
  '/demo': renderDemo(),
  '/demo/journey': renderDemoJourney(),
  '/exam-simulation': renderExamSim(),
  '/minicheck': renderMiniCheck(),
  '/app/minicheck': renderMiniCheck(),
  '/tutor': renderTutor(),
  '/ai-tutor': renderTutor(),
  '/app/tutor': renderTutor(),
  '/oral-exam': renderOral(),
  '/oral': renderOral(),
  '/app/oral': renderOral(),
  '/muendlich': renderOral(),
  '/muendliche-pruefung': renderOral(),
  '/dashboard': renderDashboard(),
};

export function PathAwareLoadingFallback() {
  const { pathname } = useLocation();
  const key = pathname.replace(/\/+$/, '') || '/';

  // Beruf-Detail: /berufe/<slug>
  if (key.startsWith('/berufe/')) {
    const slug = key.replace('/berufe/', '').split('/')[0];
    return <div dangerouslySetInnerHTML={{ __html: renderBerufDetail(slug) }} />;
  }

  const html = SHELL[key];
  if (html) return <div dangerouslySetInnerHTML={{ __html: html }} />;

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

const wrap = (data: string, body: string) =>
  `<main data-loading-shell="${data}" style="max-width:1040px;margin:0 auto;padding:48px 24px;font-family:Inter,system-ui,sans-serif;color:#0f172a;">${body}</main>`;

const btnPrimary =
  'display:inline-block;background:#0F3D3E;color:#fff;font-weight:600;padding:14px 22px;border-radius:10px;text-decoration:none;';
const btnSecondary =
  'display:inline-block;background:transparent;color:#0F3D3E;font-weight:600;padding:14px 22px;border-radius:10px;text-decoration:none;border:1px solid #0F3D3E;';

function renderBerufe() {
  const BERUFE: Array<[string, string, string]> = [
    ['einzelhandelskaufmann-frau', 'Einzelhandelskaufmann/-frau', 'IHK'],
    ['kaufmann-frau-bueromanagement', 'Kaufmann/-frau für Büromanagement', 'IHK'],
    ['industriekaufmann-frau', 'Industriekaufmann/-frau', 'IHK'],
    ['fachinformatiker-systemintegration', 'Fachinformatiker/-in Systemintegration', 'IHK'],
    ['kfz-mechatroniker-in', 'Kfz-Mechatroniker/-in', 'HWK'],
    ['bankkaufmann-frau', 'Bankkaufmann/-frau', 'IHK'],
    ['medizinische-fachangestellte', 'Medizinische/r Fachangestellte/r', 'ÄK'],
    ['pflegefachmann-frau', 'Pflegefachmann/-frau', 'PflBG'],
  ];
  const items = BERUFE.map(
    ([s, t, k]) =>
      `<li><a href="/berufe/${s}" data-cta-location="berufe_loading_item" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;text-decoration:none;color:#0f172a;font-weight:600;"><span><span style="display:inline-block;font-size:11px;letter-spacing:.08em;color:#64748b;text-transform:uppercase;margin-right:8px;">${k}</span>${t}</span><span style="color:#0F3D3E;font-weight:600;font-size:14px;white-space:nowrap;">Prüfung starten →</span></a></li>`,
  ).join('');
  return wrap(
    'berufe',
    `<h1 style="font-size:40px;line-height:1.1;margin:0 0 12px;">Wähle deinen Beruf</h1><p style="font-size:18px;color:#334155;margin:0 0 28px;max-width:680px;">Adaptiver Lernplan, KI-Tutor mit Quellen, prüfungsnahe Simulationen — pro Beruf maßgeschneidert.</p><ul style="list-style:none;padding:0;margin:0;display:grid;gap:10px;">${items}</ul>`,
  );
}

function renderBerufDetail(slug: string) {
  const title = decodeURIComponent(slug).replace(/-/g, ' ');
  return wrap(
    'beruf-detail',
    `<p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;margin:0 0 8px;"><a href="/berufe" style="color:#64748b;text-decoration:none;">← Alle Berufe</a> · IHK-Abschlussprüfung</p><h1 style="font-size:36px;line-height:1.15;margin:0 0 12px;">${title} — Prüfungstraining</h1><p style="font-size:17px;color:#334155;margin:0 0 24px;max-width:680px;">Adaptiver 4-Wochen-Lernplan, KI-Tutor mit Quellen, Mini-Checks, prüfungsnahe Simulationen und mündliches Fachgespräch. <strong>Einmalig 24,90 €</strong> · 12 Monate Zugang.</p><p style="margin:0;display:flex;gap:12px;flex-wrap:wrap;"><a href="/preise" data-cta-location="beruf_detail_loading_primary" style="${btnPrimary}">Prüfung starten →</a><a href="/berufe" data-cta-location="beruf_detail_loading_switch" style="${btnSecondary}">Anderen Beruf wählen</a></p>`,
  );
}

function renderPreise() {
  return wrap(
    'preise',
    `<p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;margin:0 0 8px;">ExamFit Komplettpaket</p><h1 style="font-size:40px;line-height:1.1;margin:0 0 12px;">Prüfungsvorbereitung — 24,90 €</h1><p style="font-size:18px;color:#334155;margin:0 0 24px;">Einmalig 24,90 € · 12 Monate Vollzugriff · Kein Abo.</p><p style="margin:0;"><a href="/berufe" data-cta-location="preise_loading" style="${btnPrimary}">Jetzt Prüfungstraining starten →</a></p>`,
  );
}

function renderDemo() {
  return wrap(
    'demo',
    `<h1 style="font-size:40px;line-height:1.1;margin:0 0 16px;">Erlebe ExamFit in 60 Sekunden.</h1><p style="font-size:18px;color:#334155;margin:0 0 24px;max-width:680px;">Klick dich durch eine Beispiel-Kohorte — ohne Anmeldung, ohne Zahlungsdaten.</p><p style="margin:0;display:flex;gap:12px;flex-wrap:wrap;"><a href="/demo/journey" data-cta-location="demo_loading_journey" style="${btnPrimary}">Activation Journey starten →</a><a href="/berufe" data-cta-location="demo_loading_berufe" style="${btnSecondary}">Beruf auswählen</a></p>`,
  );
}

function renderDemoJourney() {
  return wrap(
    'demo-journey',
    `<h1 style="font-size:36px;line-height:1.15;margin:0 0 12px;">Die BerufsKI-Story in 5 Schritten.</h1><p style="font-size:17px;color:#334155;margin:0 0 24px;max-width:680px;">Risiko → Ursache → Intervention → Wirkung → Outcome. Keine Sackgasse, jederzeit zurück zur Demo-Übersicht.</p><p style="margin:0;display:flex;gap:12px;flex-wrap:wrap;"><a href="/demo/journey?stage=risk" data-cta-location="demo_journey_loading_start" style="${btnPrimary}">Journey starten →</a><a href="/berufe" data-cta-location="demo_journey_loading_berufe" style="${btnSecondary}">Beruf auswählen</a></p>`,
  );
}

function renderExamSim() {
  return wrap(
    'exam-simulation',
    `<h1 style="font-size:36px;line-height:1.15;margin:0 0 12px;">Schriftliche Prüfung simulieren.</h1><p style="font-size:17px;color:#334155;margin:0 0 24px;max-width:640px;">Prüfungsnahe Simulation mit Zeitlimit, gemischten Aufgabenformaten und Readiness-Score.</p><p style="margin:0;display:flex;gap:12px;flex-wrap:wrap;"><a href="/app/dashboard" data-cta-location="exam_sim_loading_start" style="${btnPrimary}">Simulation starten →</a><a href="/berufe" data-cta-location="exam_sim_loading_berufe" style="${btnSecondary}">Beruf auswählen</a></p>`,
  );
}

function renderMiniCheck() {
  return wrap(
    'minicheck',
    `<h1 style="font-size:36px;line-height:1.15;margin:0 0 12px;">In 3 Minuten Wissensstand prüfen.</h1><p style="font-size:17px;color:#334155;margin:0 0 24px;max-width:640px;">Fünf gezielte Fragen pro Kompetenz, sofortige Auswertung, klarer nächster Schritt.</p><p style="margin:0;display:flex;gap:12px;flex-wrap:wrap;"><a href="/app/dashboard" data-cta-location="minicheck_loading_start" style="${btnPrimary}">MiniCheck starten →</a><a href="/berufe" data-cta-location="minicheck_loading_berufe" style="${btnSecondary}">Beruf auswählen</a></p>`,
  );
}

function renderTutor() {
  return wrap(
    'tutor',
    `<h1 style="font-size:36px;line-height:1.15;margin:0 0 12px;">Frag deinen Prüfungs-Tutor.</h1><p style="font-size:17px;color:#334155;margin:0 0 24px;max-width:640px;">Strict-RAG mit Quellen. Stelle deine Frage — der Tutor antwortet auf Basis deines Curriculums.</p><label for="tutor-loading-input" style="display:block;font-size:13px;color:#475569;margin:0 0 6px;">Deine Frage</label><input id="tutor-loading-input" type="text" placeholder="z. B. Was ist eine GuV?" disabled style="width:100%;max-width:560px;padding:12px 14px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;color:#94a3b8;font-size:15px;margin:0 0 16px;" /><p style="margin:0;display:flex;gap:12px;flex-wrap:wrap;"><a href="/app/tutor" data-cta-location="tutor_loading_open" style="${btnPrimary}">Tutor öffnen →</a><a href="/berufe" data-cta-location="tutor_loading_berufe" style="${btnSecondary}">Beruf auswählen</a></p>`,
  );
}

function renderOral() {
  return wrap(
    'oral',
    `<h1 style="font-size:36px;line-height:1.15;margin:0 0 12px;">Übe das mündliche Fachgespräch.</h1><p style="font-size:17px;color:#334155;margin:0 0 24px;max-width:640px;">Realistische Prüfer-Persona, adaptive Folgefragen, strukturiertes Feedback. Sprechen oder tippen — beides gleichwertig bewertet.</p><p style="margin:0;display:flex;gap:12px;flex-wrap:wrap;"><a href="/app/dashboard" data-cta-location="oral_loading_start" style="${btnPrimary}">Trainer starten →</a><a href="/berufe" data-cta-location="oral_loading_berufe" style="${btnSecondary}">Beruf auswählen</a></p>`,
  );
}

function renderDashboard() {
  return wrap(
    'dashboard',
    `<p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;margin:0 0 8px;">Dein nächster Schritt</p><h1 style="font-size:32px;line-height:1.15;margin:0 0 16px;">Weiter mit deinem Prüfungstraining.</h1><p data-testid="dashboard-next-step" style="margin:0 0 16px;display:flex;gap:12px;flex-wrap:wrap;"><a href="/berufe" data-cta-location="dashboard_loading_next_step" style="${btnPrimary}">Prüfung starten →</a><a href="/courses" data-cta-location="dashboard_loading_weiterlernen" style="${btnSecondary}">Weiterlernen</a></p><div data-testid="dashboard-quick-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:520px;"><a href="/minicheck" data-cta-location="dashboard_loading_minicheck" style="${btnSecondary}">MiniCheck fortsetzen</a><a href="/exam-simulation" data-cta-location="dashboard_loading_simulation" style="${btnSecondary}">Prüfung simulieren</a></div>`,
  );
}
