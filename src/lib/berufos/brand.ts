/**
 * BerufOS Masterbrand SSOT v3 (P8 — Primary-Domain-Cutover 2026-05-25).
 *
 * BerufOS ist die einzige Plattform-Authority. Sub-Brands sind Module unter
 * berufos.com/<slug>, NICHT mehr eigene Domains:
 *  - ExamFit (LearningOS)   → /examfit
 *  - Berufs-KI (WorkforceOS) → /berufs-ki
 *  - 8 weitere Module (siehe modules.ts)
 *
 * Legacy-Domain examfit.de (+ www) ist AUSSCHLIESSLICH 301-Redirect-Shell
 * (noindex). Keine SEO-Authority, keine separaten Brand-URLs, keine sameAs-
 * Entities. www.berufos.com → berufos.com. examfitwork.de/berufski.de existieren
 * NICHT (niemals registriert) — keine Referenzen aufbauen.
 */
export const BERUFOS = {
  name: "BerufOS",
  tagline: "Das AI-Betriebssystem für Berufe.",
  subline:
    "BerufOS verbindet Lernen, Arbeit, Agenten, Dokumente, Workflows und Kompetenzen in einer zentralen AI-native Plattform.",
  /** Primäre Plattform-Domain (Apex). SSOT für Canonicals + Org-JSON-LD. */
  domain: "https://berufos.com",
  hubPath: "/berufos",

  /** Domain-Topologie. Authority = apex only; www = canonical-redirect.
   *  Sunset 2026-06-04: examfit.de wird NICHT mehr betrieben — keine Legacy-Redirects mehr.
   */
  domains: {
    primary: "berufos.com",
    /** SEO-autoritative Hosts. www.berufos.com ist 301 → apex, aber bleibt indexierbar als alias. */
    authority: ["berufos.com", "www.berufos.com"],
    /** Keine Legacy-Redirect-Domains mehr. examfit.de wurde stillgelegt. */
    legacy: [] as ReadonlyArray<{ host: string; module: string; role: string }>,
  },

  /** Stripe-Branding — neue Produkte werden mit platform=berufos getaggt. */
  stripe: {
    masterBrand: "BerufOS",
    /** Bestehende Sub-Brands bleiben als statement_descriptor_suffix. */
    subBrands: ["ExamFit", "ExamFit@work"],
  },

  /** Email-SSOT für transactional + support. */
  email: {
    from: "BerufOS <hello@berufos.com>",
    support: "support@berufos.com",
    noreply: "noreply@berufos.com",
    billing: "billing@berufos.com",
    /** examfit.de wird stillgelegt — keine Forwarding-Aliases mehr aktiv. */
    legacy: [] as ReadonlyArray<string>,
  },

  /** Tonalitäts-Marker für Copy-Guardrails. */
  voice: {
    register: "enterprise-calm",
    avoid: ["chatbot", "credit", "coin", "playground", "magic", "promptbar"],
    prefer: ["Plattform", "Betriebssystem", "Runtime", "Governance", "Berufslogik", "Kompetenz"],
  },

  /** Sub-Brands leben jetzt als Module unter berufos.com — keine eigenen Domains mehr. */
  subBrands: {
    examfit: {
      name: "ExamFit",
      role: "LearningOS",
      domain: "https://berufos.com/examfit",
      moduleSlug: "examfit",
      promise: "Bestehe deine Prüfung mit System.",
    },
    berufsKi: {
      name: "Berufs-KI",
      role: "WorkforceOS",
      domain: "https://berufos.com/berufs-ki",
      moduleSlug: "berufs-ki",
      promise: "AI-Agenten für echte Arbeitsprozesse.",
    },
  },
} as const;

export type BerufosModuleStatus = "live" | "preview" | "planned";

export function statusLabel(s: BerufosModuleStatus): string {
  return s === "live" ? "Live" : s === "preview" ? "Preview" : "In Entwicklung";
}

/** True wenn host eine Legacy-Domain ist (examfit.de + www nur). */
export function isLegacyDomain(host: string | undefined | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/^www\./, "");
  return BERUFOS.domains.legacy.some((d) => d.host === h);
}

/** True wenn host die BerufOS-Primary-Domain ist. */
export function isBerufosPrimary(host: string | undefined | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/^www\./, "");
  return h === BERUFOS.domains.primary;
}

/**
 * Liefert die kanonische BerufOS-URL für eine Legacy-Path-Map.
 * NICHT für ExamFit-Routes nutzen vor M5 — sonst SEO-Drift.
 * Aktuell nur für /berufos/* Routes auf berufos.com gedacht.
 */
export function berufosCanonicalUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BERUFOS.domain}${p}`;
}
