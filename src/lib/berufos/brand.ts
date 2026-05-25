/**
 * BerufOS Masterbrand SSOT v2.
 *
 * BerufOS ist die AI-native Workforce-Plattform-Dachmarke. Darunter leben:
 *  - ExamFit (LearningOS)   — examfit.de (Legacy-Domain, später Redirect)
 *  - Berufs-KI (WorkforceOS) — examfitwork.de (Legacy-Domain, später Redirect)
 *  - 8 weitere Module (siehe modules.ts)
 *
 * Migration: examfit.de + examfitwork.de werden 301-Redirect-Domains auf
 * berufos.com/<modul>/* nach M5-Lock. Bis dahin: Parallelbetrieb mit Bridge.
 *
 * Diese SSOT ersetzt die VibeOS-Masterbrand-Strategie vollständig.
 */
export const BERUFOS = {
  name: "BerufOS",
  tagline: "Das AI-Betriebssystem für Berufe.",
  subline:
    "BerufOS verbindet Lernen, Arbeit, Agenten, Dokumente, Workflows und Kompetenzen in einer zentralen AI-native Plattform.",
  /** Primäre Plattform-Domain. SSOT für Canonicals + Org-JSON-LD. */
  domain: "https://berufos.com",
  hubPath: "/berufos",

  /** Domain-Topologie für Brücken, Canonicals & Redirect-Logik (M5). */
  domains: {
    primary: "berufos.com",
    /** Hosts, die als „Authority“ gelten (kein noindex). */
    authority: ["berufos.com", "www.berufos.com", "examfit.de", "www.examfit.de"],
    /** Legacy/Sub-Brand-Domains — werden in M5 auf berufos.com/<modul> redirected. */
    legacy: [
      { host: "examfit.de", module: "examfit", role: "LearningOS" },
      { host: "examfitwork.de", module: "berufs-ki", role: "WorkforceOS" },
      { host: "berufski.de", module: "berufs-ki", role: "WorkforceOS" },
    ],
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
    /** Legacy-Adressen bleiben parallel aktiv bis M4-Lock. */
    legacy: ["support@examfit.de", "noreply@examfitwork.de"],
  },

  /** Tonalitäts-Marker für Copy-Guardrails. */
  voice: {
    register: "enterprise-calm",
    avoid: ["chatbot", "credit", "coin", "playground", "magic", "promptbar"],
    prefer: ["Plattform", "Betriebssystem", "Runtime", "Governance", "Berufslogik", "Kompetenz"],
  },

  /** Sub-Brands, die unter BerufOS leben — eigene SSOTs bleiben unangetastet. */
  subBrands: {
    examfit: {
      name: "ExamFit",
      role: "LearningOS",
      domain: "https://examfit.de",
      moduleSlug: "examfit",
      promise: "Bestehe deine Prüfung mit System.",
    },
    berufsKi: {
      name: "Berufs-KI",
      role: "WorkforceOS",
      domain: "https://examfitwork.de",
      moduleSlug: "berufs-ki",
      promise: "AI-Agenten für echte Arbeitsprozesse.",
    },
  },
} as const;

export type BerufosModuleStatus = "live" | "preview" | "planned";

export function statusLabel(s: BerufosModuleStatus): string {
  return s === "live" ? "Live" : s === "preview" ? "Preview" : "In Entwicklung";
}

/** True wenn host eine Legacy-Domain ist (examfit.de, examfitwork.de, ...). */
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
