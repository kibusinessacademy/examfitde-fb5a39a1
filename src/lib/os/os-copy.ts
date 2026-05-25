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

/* ============================================================
 * Reaction Lines — was das System "sagt", wenn der Nutzer was tut.
 * Verwendet von OSReactionLine. Kurz, persönlich, Ich-Form.
 * ============================================================ */

/** Antwort auf Beruf-Auswahl im Hero. */
export function berufReactionLine(beruf: { label: string; short?: string }): string {
  const name = beruf.short ?? beruf.label;
  const variants = [
    `${name} verstanden — ich richte schriftliche und mündliche Prüfung danach aus.`,
    `${name} — ich kenne deine typischen Stolperstellen. 4 Minuten reichen, um sie zu finden.`,
    `Alles klar, ${name}. Ich frage gleich nach Schwächen, nicht nach Wissen.`,
  ];
  // deterministisch über slug-ähnlichen label-hash, damit Wechsel nicht „blinkt"
  const seed = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return variants[seed % variants.length];
}

/** Tageszeit-bewusste Begrüßung. */
export function greetingFor(d: Date = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "Du bist spät dran";
  if (h < 11) return "Guten Morgen";
  if (h < 14) return "Hallo";
  if (h < 18) return "Guten Nachmittag";
  if (h < 22) return "Guten Abend";
  return "Späte Stunde";
}

/** Nuancierte Recalc-Nachricht für die Companion-Bar. */
export function recalcLineFor(message: string | undefined, beruf?: string | null): string {
  if (!message) return OS_TONE.companion.recalcGeneric;
  const m = message.toLowerCase();
  if (m.includes("oral") || m.includes("mündlich"))
    return "Ich richte das mündliche Profil neu aus.";
  if (m.includes("score") || m.includes("readiness") || m.includes("prüfungsreife"))
    return beruf
      ? `Prüfungsreife für ${beruf} aktualisiert.`
      : "Prüfungsreife aktualisiert.";
  if (m.includes("schwäche") || m.includes("risk") || m.includes("risiko"))
    return "Mir fällt eine neue Schwachstelle auf.";
  if (m.includes("strategie") || m.includes("plan"))
    return "Ich habe deine Strategie geschärft.";
  return message;
}

