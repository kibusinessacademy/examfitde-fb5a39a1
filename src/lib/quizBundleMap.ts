/**
 * Quiz → Bundle/Lernplan/Simulation Mapping (SSOT, Frontend)
 * ----------------------------------------------------------
 * Eindeutiges Mapping pro quiz_slug. Klon-sicher: keine Title-Heuristiken.
 * Zukünftig aus DB ableitbar (lead_quizzes.curriculum_id + curriculum_products),
 * vorerst Hardcoded-Mapping als Single Source of Truth.
 *
 * REGEL: Jedes quiz_slug MUSS hier registriert sein, sonst zeigt die UI
 *        eine harte Fehlermeldung und der Funnel bricht kontrolliert ab.
 */

export interface QuizBundleMapping {
  /** stabile UUID des curriculums (curricula.id) */
  curriculumId: string;
  /** SEO-Slug der Bundle-Detailseite (/bundle/:slug) */
  bundleSlug: string;
  /** Anzeige-Titel des Bundles (für CTA) */
  bundleTitle: string;
  /** Slug für /lernplan/:slug — defaultet auf quiz_slug */
  lernplanSlug?: string;
  /** Route der mündlichen Prüfungssimulation */
  simulationRoute: string;
  /** Track-Label für SEO/Pillar */
  pillarLabel: string;
}

export const QUIZ_BUNDLE_MAP: Record<string, QuizBundleMapping> = {
  "aevo-pruefungsreife": {
    curriculumId: "c2e41dc3-0fdb-4906-a694-485d0ddea180",
    bundleSlug: "ausbildereignungspruefung-aevo",
    bundleTitle: "AEVO Komplett-Bundle",
    lernplanSlug: "aevo-pruefungsreife",
    simulationRoute: "/pruefungstraining/aevo",
    pillarLabel: "AEVO",
  },
  "bilanzbuchhalter-pruefungsreife": {
    curriculumId: "235168bb-87b6-43be-a91a-d46bddc9cb02",
    bundleSlug: "bilanzbuchhalter-ihk",
    bundleTitle: "Bilanzbuchhalter Komplett-Bundle",
    lernplanSlug: "bilanzbuchhalter-pruefungsreife",
    simulationRoute: "/pruefungstraining/fachwirt/bilanzbuchhalter",
    pillarLabel: "Bilanzbuchhalter",
  },
  "wirtschaftsfachwirt-pruefungsreife": {
    curriculumId: "1962472c-e2cc-4e38-974e-64036e6c9f4e",
    bundleSlug: "wirtschaftsfachwirt-ihk",
    bundleTitle: "Wirtschaftsfachwirt Komplett-Bundle",
    lernplanSlug: "wirtschaftsfachwirt-pruefungsreife",
    simulationRoute: "/pruefungstraining/fachwirt/wirtschaftsfachwirt",
    pillarLabel: "Wirtschaftsfachwirt",
  },
  "fiae-pruefungsreife": {
    curriculumId: "a8a6340d-fd50-445f-a55b-7d5a6c72e2e1",
    bundleSlug: "fachinformatiker-anwendungsentwicklung",
    bundleTitle: "Fachinformatiker AE Komplett-Bundle",
    lernplanSlug: "fiae-pruefungsreife",
    simulationRoute: "/pruefungstraining/fachinformatiker-ae",
    pillarLabel: "Fachinformatiker AE",
  },
};

export function getQuizBundleMapping(
  quizSlug: string | undefined | null
): QuizBundleMapping | null {
  if (!quizSlug) return null;
  return QUIZ_BUNDLE_MAP[quizSlug] ?? null;
}

/** Reverse-Lookup: gibt das passende Quiz für einen Bundle-Slug zurück (für Cross-Linking). */
export function getQuizSlugForBundle(bundleSlug: string): string | null {
  const entry = Object.entries(QUIZ_BUNDLE_MAP).find(
    ([, v]) => v.bundleSlug === bundleSlug
  );
  return entry?.[0] ?? null;
}
