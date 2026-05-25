/**
 * OS-Copy SSOT — Tonalität für alle User-Surfaces (Hero · Pruefungscheck · /app).
 *
 * Eine einzige Wahrheit über die Sprache, in der das System mit dem Nutzer
 * spricht. Wird vom OS-Spine (CompanionBar, BerufIdentityChip, AnticipationCard)
 * konsumiert und ersetzt verstreute Admin-Strings.
 *
 * Register: Notion AI / Superhuman — antizipierend, warm, kompakt, in der Ich-Form
 * des Systems ("ich richte aus", "mir fällt auf"). Niemals Status-Sprache.
 *
 * Verboten in User-Surfaces: Status, Modul, Run, Failed, Dashboard, Quiz.
 */

export const OS_TONE = {
  // Companion-Bar Defaults pro Surface
  companion: {
    landing: "Sag mir deinen Beruf — ich richte deine Prüfung aus.",
    landingWithBeruf: (beruf: string) =>
      `${beruf} verstanden — ich baue deine Prüfung in 4 Minuten.`,
    pruefungscheck: "Ich kalibriere deinen Prüfungszustand — eine Frage nach der anderen.",
    pruefungscheckResult: "Ich habe verstanden, wo du stehst.",
    appHome: (readiness: number) =>
      `Heute fokussieren wir das, was deine Prüfungsreife am meisten anhebt.`,
    appHomeUrgent: "Mir fällt auf — du verlierst hier seit Tagen Punkte. Lass uns das jetzt angehen.",
    recalcGeneric: "Ich passe deine Schwerpunkte an.",
  },

  // Beruf-Echo nach Auswahl (einmalig sichtbar)
  berufEcho: (beruf: string) => `${beruf} verstanden — ich richte alles aus.`,

  // Anticipation-Card Eröffnungen (System-Stimme)
  insight: {
    suggest: "Mein Vorschlag",
    notice: "Mir fällt auf",
    plan: "Heute",
    care: "Ich pass auf für dich",
  },

  // Trust / Hero
  hero: {
    eyebrow: "Dein Prüfungs-Betriebssystem",
    sublineCore:
      "Es kennt deinen Beruf, erkennt deine Schwächen und führt dich Tag für Tag näher an deine Prüfung.",
    primaryCta: "Lass mich kurz draufschauen",
    primaryCtaWithBeruf: (short: string) => `Prüfung für ${short} kalibrieren`,
    trustChips: ["4 Minuten", "Keine Anmeldung", "Mit Quellen", "Schriftlich + mündlich"],
  },

  // Übersetzungs-Map: Admin-Sprache → OS-Sprache (Referenz für Refactor / Guards)
  translate: {
    Status: "Zustand",
    Modul: "Thema",
    Run: "heute",
    Dashboard: "Heute",
    Failed: "Nicht sicher — hier nochmal",
    "Auswahl bestätigen": "Verstanden — los geht's",
    "Prüfungszustand analysieren": "Lass mich kurz draufschauen",
  },
} as const;

/** Welche Routen führen den OS-Spine? Admin bleibt bewusst ausgeschlossen. */
export const OS_SURFACE_PREFIXES = [
  "/", // landing — exact match handled by caller
  "/pruefungscheck",
  "/pruefungsreife-ergebnis",
  "/app",
] as const;

export function isOsSurface(pathname: string): boolean {
  if (pathname.startsWith("/admin")) return false;
  if (pathname === "/" || pathname === "") return true;
  return (
    pathname.startsWith("/app") ||
    pathname.startsWith("/pruefungscheck") ||
    pathname.startsWith("/pruefungsreife-ergebnis")
  );
}

export function companionMessageFor(
  pathname: string,
  ctx: { beruf?: string | null; readiness?: number; urgent?: boolean } = {},
): string {
  if (pathname.startsWith("/pruefungsreife-ergebnis")) return OS_TONE.companion.pruefungscheckResult;
  if (pathname.startsWith("/pruefungscheck")) return OS_TONE.companion.pruefungscheck;
  if (pathname.startsWith("/app")) {
    if (ctx.urgent) return OS_TONE.companion.appHomeUrgent;
    return OS_TONE.companion.appHome(ctx.readiness ?? 0);
  }
  // landing
  return ctx.beruf ? OS_TONE.companion.landingWithBeruf(ctx.beruf) : OS_TONE.companion.landing;
}
