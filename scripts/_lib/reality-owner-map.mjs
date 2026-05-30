// SSOT: route → owner / surface / fix-hint mapping for Customer-Reality triage.
// "Owner" is a logical area, not a person. Used by customer-reality-triage.mjs
// to auto-classify findings without inventing new metadata in tests.

export const OWNER_MAP = [
  // Pre-Login funnel
  { match: /^\/$/,                       owner: 'marketing-home',     surface: 'Homepage' },
  { match: /^\/berufe/,                  owner: 'discovery',          surface: 'Beruf-Hub' },
  { match: /^\/kurs|^\/produkt/,         owner: 'commerce-product',   surface: 'Kursseite' },
  { match: /^\/preise|pricing/i,         owner: 'commerce-pricing',   surface: 'Preise' },
  { match: /^\/checkout|stripe\.com/i,   owner: 'commerce-checkout',  surface: 'Checkout' },
  { match: /^\/komplettpaket/,           owner: 'commerce-bundle',    surface: 'Komplettpaket' },
  { match: /^\/berufos|^\/os/,           owner: 'berufos-hub',        surface: 'BerufOS' },
  // Auth + onboarding
  { match: /^\/auth/,                    owner: 'auth',               surface: 'Auth' },
  { match: /^\/onboarding/,              owner: 'onboarding',         surface: 'Onboarding' },
  // Learner app
  { match: /^\/app\/?$|^\/dashboard/,    owner: 'learner-dashboard',  surface: 'Dashboard' },
  { match: /^\/app\/lernen|^\/lernen/,   owner: 'learner-learning',   surface: 'Lernen' },
  { match: /minicheck|daily-challenge/i, owner: 'learner-minicheck',  surface: 'MiniCheck' },
  { match: /tutor/i,                     owner: 'ai-tutor',           surface: 'AI-Tutor' },
  { match: /pruefung|exam/i,             owner: 'learner-exam',       surface: 'Prüfung' },
  { match: /oral/i,                      owner: 'learner-oral',       surface: 'Mündliche Prüfung' },
];

export const KIND_FIX_HINT = {
  dead_cta:            'CTA-Handler oder Route prüfen — CTA darf nie ohne Folgezustand klickbar sein.',
  dead_button:         'Button-Action verkabeln oder Button entfernen.',
  broken_route:        'Route-Definition in AppRoutes prüfen oder 410/301 setzen.',
  white_screen:        'Render-Path prüfen: Suspense-Boundary, Error-Boundary, fehlende Daten.',
  spinner_loop:        'Query-Endzustand prüfen (kein onError/onEmpty) oder Timeout setzen.',
  console_error:       'Stacktrace im Artifact öffnen — Quelle ist im pageerror-Log.',
  missing_trust_page:  'Pflichtseite anlegen (Impressum/Datenschutz/AGB).',
  login_failed:        'Reality-Testnutzer + Auth-Flow prüfen; SSOT für Session-State.',
  sidebar_broken:      'Nav-Items gegen aktuelle Route-Matrix abgleichen.',
  workflow_no_feedback:'Toast/State-Feedback nach User-Action ergänzen.',
  placeholder_end_state:'Echte Inhalte ausliefern oder Empty-State mit Recovery-CTA.',
  demo_unreachable:    'Demo-Route oder Public-Visibility wiederherstellen.',
  checkout_unreachable:'CTA→Stripe-Pfad reparieren (create-payment edge fn).',
  role_blocked:        'RLS/Has-Role-Gate prüfen — Test-Rolle gegen Policy abgleichen.',
  http_error:          'Server-Log + Edge-Function-Log für betroffene Route prüfen.',
};

export function classifyFinding(f) {
  const route = f?.route || '';
  const hit = OWNER_MAP.find((m) => m.match.test(route));
  return {
    owner: hit?.owner ?? 'unassigned',
    surface: hit?.surface ?? (route ? 'Sonstige' : 'Global'),
    fix_hint: f?.fix || KIND_FIX_HINT[f?.kind] || 'Im Artifact-Log Quelle prüfen.',
  };
}
