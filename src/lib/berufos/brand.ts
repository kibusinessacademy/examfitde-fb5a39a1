/**
 * BerufOS Masterbrand SSOT.
 *
 * BerufOS ist die AI-native Workforce-Plattform-Dachmarke. Darunter leben:
 *  - ExamFit (LearningOS)   — examfit.de bleibt eigene Domain & Brand-SSOT
 *  - Berufs-KI (WorkforceOS) — examfitwork.de bleibt eigene Domain & Brand-SSOT
 *  - 8 weitere Module (siehe modules.ts)
 *
 * Tonalität: ruhig, intelligent, modern, strukturiert, enterprise, hochwertig,
 * vertrauenswürdig. NIE: verspielt, neon-cyberpunk, generisch-saas, chatgpt-klon,
 * credit/coin-optik.
 *
 * Diese SSOT ersetzt die VibeOS-Masterbrand-Strategie vollständig
 * (siehe mem://design/vibeos-masterbrand-v1 → deprecated zugunsten BerufOS).
 */
export const BERUFOS = {
  name: "BerufOS",
  tagline: "Das AI-Betriebssystem für Berufe.",
  subline:
    "BerufOS verbindet Lernen, Arbeit, Agenten, Dokumente, Workflows und Kompetenzen in einer zentralen AI-native Plattform.",
  domain: "https://berufos.com",
  hubPath: "/berufos",
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
      promise: "Bestehe deine Prüfung mit System.",
    },
    berufsKi: {
      name: "Berufs-KI",
      role: "WorkforceOS",
      domain: "https://examfitwork.de",
      promise: "AI-Agenten für echte Arbeitsprozesse.",
    },
  },
} as const;

export type BerufosModuleStatus = "live" | "preview" | "planned";

export function statusLabel(s: BerufosModuleStatus): string {
  return s === "live" ? "Live" : s === "preview" ? "Preview" : "In Entwicklung";
}
