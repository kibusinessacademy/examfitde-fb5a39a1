/**
 * SSOT route registry — mirrors src/routes/AppRoutes.tsx.
 *
 * Generated/maintained from `<Route path="…" />` declarations.
 * Used by:
 *  - SafeCta runtime guard
 *  - cta-routes vitest E2E
 *  - scripts/guards/cta-link-existence-guard.mjs
 *
 * Patterns may contain `:param` segments and a trailing `/*` wildcard.
 */

/** Top-level + nested routes that the SPA actually serves. */
export const ROUTE_PATTERNS: readonly string[] = [
  // Public root
  "/",
  "/auth",
  "/auth/reset-password",
  "/installieren",
  "/renew",
  "/tools/event-inspector",
  "/diag",
  "/quiz/:slug",
  "/lernplan/:slug",
  "/pruefungsreife-ergebnis/:attemptId",
  "/purchase-success",
  "/willkommen",
  "/willkommen/aha",
  "/checkout/success",

  // /app
  "/app",
  "/app/start",
  "/app/oral",
  "/app/lernpfad",
  "/app/tutor",
  "/app/kompetenz",
  "/app/kompetenz/:competencyId",
  "/app/minicheck",
  "/app/minicheck/:competencyId",
  "/app/exam-trainer",
  "/app/profil",
  "/app/rechnungen",
  "/app/downloads",
  "/app/lizenzen",
  "/app/meine-kurse",
  "/app/benachrichtigungen",
  "/app/dsgvo",
  "/app/support",

  // Public diagnostic
  "/pruefungscheck",
  "/pruefungscheck/:slug",

  // ExamFit@work
  "/work",
  "/partner",
  "/work/success",
  "/work/buy/:productId",
  "/work/corporate",

  // Berufs-KI (eigenständige Produktlinie)
  "/berufs-ki",
  "/berufs-ki/app",
  "/admin/berufs-ki/workflows",
  "/admin/berufs-ki/quality",
  "/admin/berufs-ki/review",
  "/admin/berufs-ki/learning",
  "/berufs-ki/inbox",
  "/berufs-ki/dokumente",
  "/admin/berufs-ki/documents",



  // Legacy 410 / redirects (still served — not 404)
  "/berufski",
  "/berufski/*",
  "/about",
  "/kontakt",
  "/registrieren",
  "/repair-courses",
  "/legal/refund",
  "/legal/impressum",
  "/legal/agb",
  "/legal/datenschutz",
  "/user/support",
  "/user/*",
  "/shop/products",
  "/products",
  "/product/:slug",
  "/category/:slug",
  "/ausbildungsberufe",
  "/apprenticeship-course-detail/:slug",
  "/learning/path/:courseId",
  "/learning/*",
  "/payment-success",
  "/sitemap",
  "/bundle",
  "/bundle/:slug",

  // Enterprise demo
  "/enterprise-demo",
  "/org",
  "/org/enterprise",

  // SEO
  "/pruefungstraining",
  "/pruefungstraining/fachwirt/wirtschaftsfachwirt",
  "/pruefungstraining/:slug/azubi",
  "/pruefungstraining/:slug/betrieb",
  "/pruefungstraining/:slug/institution",
  "/pruefungstraining/:category/:slug",
  "/pruefungstraining/:slug",
  "/ausbildung",
  "/ausbildung/:slug",
  "/fachwirt",
  "/fachwirt/:slug",
  "/meister",
  "/meister/:slug",
  "/sachkunde",
  "/sachkunde/:slug",
  "/projektmanagement",
  "/projektmanagement/:slug",
  "/pruefung/:slug",
  "/produkt/:slug",
  "/landing/:landingType/:slug",
  "/pruefungstraining-azubis/:slug",
  "/pruefungstraining-sachkunde/:slug",
  "/pruefungstraining-fachwirt/:slug",
  "/pruefungstraining-studium/:slug",
  "/kurse/:curriculumSlug",
  "/kurse/:curriculumSlug/:intentSlug/:competencySlug",
  "/pruefungsfragen",
  "/muendliche-pruefung",
  "/probepruefung",
  "/lernplan-pruefung",
  "/themen",

  "/ihk-pruefungsvorbereitung",
  "/ihk-pruefungsfragen",
  "/ihk-fachgespraech",
  "/ihk-probepruefung",

  "/aevo-pruefungsvorbereitung",
  "/aevo-schriftliche-pruefung",
  "/aevo-praktische-pruefung",
  "/aevo-fachgespraech",

  "/bilanzbuchhalter-pruefungsvorbereitung",
  "/bilanzbuchhalter-buchhaltung",
  "/bilanzbuchhalter-jahresabschluss",
  "/bilanzbuchhalter-steuern",

  "/fachinformatiker-ae-pruefungsvorbereitung",
  "/fiae-anwendungsentwicklung",
  "/fiae-wiso",
  "/fiae-projektarbeit",

  "/studium-pruefungsvorbereitung",
  "/klausurtraining-studium",
  "/bwl-klausur",
  "/rechnungswesen-studium",
  "/lernplan-studium",
  "/pruefungsangst-studium",
  "/muendliche-pruefung-studium",

  "/scrum-prince2-zertifizierung",
  "/scrum-psm-vorbereitung",
  "/scrum-csm-training",
  "/prince2-foundation",
  "/prince2-practitioner",
  "/scrum-prince2-vergleich",

  "/ihk-pruefungen",
  "/ihk-pruefungen/:slug",
  "/pruefungstraining-azubis",
  "/pruefungstraining-betriebe",
  "/pruefungstraining-institutionen",
  "/pruefungstraining-ausbildung",
  "/pruefungstraining-berufsschulen",
  "/pruefungstraining-weiterbildung",
  "/pruefungstraining-studium",
  "/pruefungstraining-fortbildung",
  "/pruefungstraining-zertifizierungen",
  "/witz/:humorId",
  "/frage-des-tages",
  "/frage-des-tages/:slug",
  "/pruefungsfehler/:slug",
  "/bestehens-rechner",
  "/bestehe-ich-die-ihk-pruefung",
  "/berufe",
  "/berufe/:slug",
  "/lernkurse",
  "/lernkurse/:slug",
  "/pruefungstrainer",
  "/pruefungstrainer/:slug",
  "/paket",
  "/paket/:slug",
  "/unternehmen",
  "/preise",
  "/karriere",
  "/betriebe",
  "/fortbildung",
  "/zertifizierungen",
  "/pruefungshandbuch",
  "/wissen",
  "/wissen/alle",
  "/wissen/beruf/:key",
  "/wissen/kompetenz/:key",
  "/wissen/pruefung/:key",
  "/wissen/:slug",
  "/suche",
  "/blog",
  "/blog/:slug",
  "/handbuch",
  "/handbuch/:chapterKey",
  "/faq",
  "/agb",
  "/datenschutz",
  "/impressum",

  // Learning / Sessions
  "/dashboard",
  "/courses",
  "/course/:slug",
  "/exam-trainer",
  "/exam-simulation",
  "/exam-simulation/:sessionId",
  "/exam-results/:sessionId",
  "/lesson/:lessonId",
  "/diagnostic/:curriculumId",
  "/drill",
  "/spaced-repetition",
  "/exam-anxiety",
  "/vark-test",
  "/daily-challenge",
  "/heatmap",
  "/shuttle",
  "/shop",

  // V1
  "/v1",

  // Admin (mounted under /admin/*)
  "/admin",
  "/admin/cockpit",
  "/admin/heal",
  "/admin/heal-cockpit",
  "/admin/heal-cockpit/package/:packageId",
  "/admin/heal/gate-history",
  "/admin/jobs/timeline",
  "/admin/queue",
  "/admin/queue/stagnation",
  "/admin/runtime",
  "/admin/observatory",
  "/admin/forensics",
  "/admin/command",
  "/admin/kpi",
  "/admin/growth",
  "/admin/growth-intelligence",
  "/admin/governance/architecture",
  "/admin/platform-conscience",
  "/admin/runbook/integrity-check",
  "/admin/security/findings",
  "/admin/studio",
  "/admin/studio/:packageId",
  "/admin/factory/export-preview/:packageId",
  "/admin/synthetic-cohort",
  "/admin/mastery/simulator",
  "/admin/test",
  "/admin/audit/bypass",
  "/admin/ops/access",
  "/admin/ops/ai-analysis-audit",
  "/admin/ops/audit-reports",
  "/admin/ops/blocker-ops",
  "/admin/ops/events",
  "/admin/ops/funnel",
  "/admin/ops/h5p",
  "/admin/ops/h5p-smoke",
  "/admin/ops/heal-settings",
  "/admin/ops/integrity-diff",
  "/admin/ops/integrity-diff/:packageId",
  "/admin/ops/orders",
  "/admin/ops/publish-blockers",
  "/admin/ops/repair-queue",
  "/admin/ops/retry-loops",
  "/admin/ops/roles",
  "/admin/ops/seo-test",
  "/admin/ops/stale-marker-diff",
  "/admin/ops/step-done-audit",
  "/admin/ops/stuck-steps",

  // Admin v2 setup wizards / activation
  "/admin/activation-os",
  "/admin/setup-wizards",

  // BerufOS brand shell
  "/berufos",
  "/berufos/:slug",
  "/vibeos",
  "/examfit",

  // Berufs-KI product modules
  "/berufs-ki/automation",
  "/berufs-ki/copilot",
  "/berufs-ki/dokumente/review",
  "/berufs-ki/graph-activation",
  "/berufs-ki/intelligence",
  "/berufs-ki/intelligence/executive",
  "/berufs-ki/suites",

  // Demo / Activation
  "/demo",
  "/demo/journey",
  "/demo/cohort/:slug",

  // Authority hub
  "/authority",
  "/authority/:topic",
  "/authority/checkliste/:slug",
  "/authority/risiko-check/:slug",
  "/authority/vorlage/:slug",

  // FördermittelOS
  "/foerdermittel",
  "/foerdermittel/aktuell",
  "/foerdermittel/antrag/checkliste",
  "/foerdermittel/branche/:industry",
  "/foerdermittel/bundesland/:state",
  "/foerdermittel/inbox",
  "/foerdermittel/inbox/:leadId",
  "/foerdermittel/kombination/:slug",
  "/foerdermittel/programm/:slug",
  "/foerdermittel/report/:reportKey",
  "/foerdermittel/reporting",
  "/foerdermittel/thema/:topic",
  "/fördermittel",

  // HR / OfferComparison / Suites
  "/hr/:slug",
  "/hr/fristenrechner-kuendigung",
  "/offer-comparison",
  "/offer-comparison/projekt/:slug",
  "/angebotsvergleich",
  "/suites",
  "/suites/:slug",

  // Misc top-level (existing in AppRoutes)
  "/agents",
  "/career",
  "/documents",
  "/governance",
  "/industries",
  "/newsletter/confirm",
  "/oral-exam",
  "/org/structure",
  "/platform",
  "/prompts",
  "/pruefungsreife-check",
  "/recruit",
  "/skills",
  "/tools/kuendigungsfrist-rechner",
  "/workflows",
];

/** Compile a Route-style pattern into a regex. */
function compilePattern(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\/\\\*$/, "(?:/.*)?") // trailing /*
    .replace(/:[A-Za-z0-9_]+/g, "[^/]+");
  return new RegExp(`^${escaped}/?$`);
}

const COMPILED: ReadonlyArray<{ pattern: string; rx: RegExp }> = ROUTE_PATTERNS.map(
  (pattern) => ({ pattern, rx: compilePattern(pattern) }),
);

/**
 * Returns true if `path` (a pathname, may include search/hash) matches a registered route.
 * External URLs (http/https/mailto/tel) are always considered valid.
 */
export function isKnownRoute(path: string): boolean {
  if (!path) return false;
  if (/^(https?:|mailto:|tel:|#)/i.test(path)) return true;
  // Strip query + hash
  const pathname = path.split("?")[0].split("#")[0];
  if (!pathname.startsWith("/")) return false;
  return COMPILED.some(({ rx }) => rx.test(pathname));
}

/** Safe SPA fallback when a CTA target is unknown or forbidden. */
export const SAFE_FALLBACK_ROUTE = "/" as const;
