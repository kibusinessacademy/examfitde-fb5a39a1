/**
 * Hero Phrasing SSOT
 *
 * Eine einzige Quelle für Hero-Überschriften und Meta-Sätze für Kurs-/Produkt-
 * Landingpages. Verhindert sprachlich falsche Sätze wie
 *   „Bestehe deine Prüfung als BWL …"
 *   „Bestehe deine Abschlussprüfung als AEVO …"
 *
 * Regel (verbindlich):
 *   Ausbildungsberuf        → „Bestehe deine Abschlussprüfung als {Beruf}."
 *   Fortbildung (IHK/HWK)   → „Bestehe deine Prüfung zum/zur {Abschluss}."
 *   Meister                 → „Bestehe deine Meisterprüfung zum/zur {Meisterabschluss}."
 *   Einzelprüfung / Zert.   → „Bereite dich optimal auf die {Prüfungsname} vor."
 *   Studium                 → „Bereite dich optimal auf deine Prüfung im Studiengang {Studiengang} vor."
 */

export type QualificationKind =
  | "ausbildung"
  | "fortbildung"
  | "meister"
  | "einzelpruefung"
  | "zertifikat"
  | "studium";

export interface HeroPhrasingInput {
  /** Roher Titel aus DB, z. B. „Ausbildereignungsprüfung (AEVO)" oder „Bankkaufmann/-frau (IHK)". */
  title: string;
  /** certification_catalog.catalog_type — wenn vorhanden, ist es die zuverlässigste Quelle. */
  catalogType?: string | null;
  /** Kammer-Typ (IHK, HWK, …) für Subline. */
  chamberType?: string | null;
}

export interface HeroPhrasing {
  kind: QualificationKind;
  /** Text vor dem hervorgehobenen Titel, z. B. „Bestehe deine Abschlussprüfung als". */
  prefix: string;
  /** Hervorgehobener Titel (Beruf/Abschluss/Prüfungsname). */
  highlight: string;
  /** Optionaler Text nach dem Titel, z. B. „– systematisch & sicher". */
  suffix?: string;
  /** Vollständiger Satz als Plain-Text (für <title>, meta, JSON-LD, Tests). */
  plain: string;
  /** Kurze, korrekte Subline (Trainings-Kontext). */
  subline: string;
}

const PAREN_SUFFIX_RE = /\s*\((?:IHK|HWK|AEVO|DIHK|ZDH|VHB|BVMW)\)\s*$/i;

/** Entfernt Kammer-Suffixe wie „ (IHK)" für natürlichen Lesefluss. */
export function stripChamberSuffix(title: string): string {
  if (!title) return title;
  return title.replace(PAREN_SUFFIX_RE, "").trim();
}

/** Entfernt Präfixe wie „Rahmenlehrplan " / „Modulhandbuch ". */
export function cleanCourseTitle(title: string): string {
  if (!title) return title;
  return title
    .replace(/^Rahmenlehrplan\s+/i, "")
    .replace(/^Modulhandbuch\s+/i, "")
    .trim();
}

/**
 * Klassifiziert die Qualifikation. catalog_type aus der DB hat Vorrang;
 * Fallback ist Heuristik auf den Titel.
 */
export function classifyQualification(input: HeroPhrasingInput): QualificationKind {
  const ct = (input.catalogType || "").toLowerCase();
  if (ct) {
    if (ct === "ausbildung") return "ausbildung";
    if (ct === "meister") return "meister";
    if (ct.startsWith("fortbildung")) return "fortbildung";
    if (ct === "studium") return "studium";
    if (ct === "sachkunde") return "einzelpruefung";
    if (ct === "branchenzertifikat" || ct === "projektmanagement") return "zertifikat";
    // "Sonstiges" (AEVO etc.) und unbekannte → Heuristik
  }

  const t = (input.title || "").toLowerCase();
  if (!t) return "einzelpruefung";

  if (/\baevo\b|ausbildereignung/i.test(t)) return "einzelpruefung";
  if (/\bsachkunde|§\s*34|§34/i.test(t)) return "einzelpruefung";
  if (/\bmeister\b/i.test(t)) return "meister";
  if (/\bfachwirt\b|\bbetriebswirt\b|\bgepr(üfter|uefter)?\b/i.test(t)) return "fortbildung";
  if (/\bb\.?\s*sc\.?\b|\bm\.?\s*sc\.?\b|\bbachelor\b|\bmaster\b|\bstudiengang\b/i.test(t)) return "studium";
  if (/zertifikat|certified|certification|\baws\b|\bitil\b|\bprince2\b|\bscrum\b/i.test(t)) return "zertifikat";
  if (/kaufmann|kauffrau|kaufleute|kauffrau\/?-frau|mechaniker|elektroniker|techniker|in\b/i.test(t)) return "ausbildung";

  return "einzelpruefung";
}

const TAGLINE = "– systematisch & sicher";

export function buildHeroPhrasing(input: HeroPhrasingInput): HeroPhrasing {
  const kind = classifyQualification(input);
  const clean = cleanCourseTitle(stripChamberSuffix(input.title || ""));
  const chamber = (input.chamberType || "").trim();

  switch (kind) {
    case "ausbildung": {
      const prefix = "Bestehe deine Abschlussprüfung als";
      return {
        kind,
        prefix,
        highlight: clean,
        suffix: TAGLINE,
        plain: `${prefix} ${clean} ${TAGLINE}`,
        subline: chamber
          ? `Trainiere exakt das, was in der ${chamber}-Abschlussprüfung drankommt — mit echten Prüfungsaufgaben, Simulation und persönlichem KI-Prüfungscoach.`
          : `Trainiere exakt das, was in der Abschlussprüfung drankommt — mit echten Prüfungsaufgaben, Simulation und persönlichem KI-Prüfungscoach.`,
      };
    }

    case "fortbildung": {
      const prefix = "Bestehe deine Fortbildungsprüfung zum/zur";
      return {
        kind,
        prefix,
        highlight: clean,
        suffix: TAGLINE,
        plain: `${prefix} ${clean} ${TAGLINE}`,
        subline: chamber
          ? `Strukturierte Vorbereitung auf die ${chamber}-Fortbildungsprüfung — mit Fallbeispielen, Prüfungsfragen und KI-Coach.`
          : "Strukturierte Vorbereitung auf die Fortbildungsprüfung — mit Fallbeispielen, Prüfungsfragen und KI-Coach.",
      };
    }

    case "meister": {
      const prefix = "Bestehe deine Meisterprüfung zum/zur";
      return {
        kind,
        prefix,
        highlight: clean,
        suffix: TAGLINE,
        plain: `${prefix} ${clean} ${TAGLINE}`,
        subline: chamber
          ? `Gezielte Vorbereitung auf die ${chamber}-Meisterprüfung — mit Fachfragen, Fallstudien und KI-Coach.`
          : "Gezielte Vorbereitung auf die Meisterprüfung — mit Fachfragen, Fallstudien und KI-Coach.",
      };
    }

    case "studium": {
      const prefix = "Bereite dich optimal auf deine Prüfungen im Studiengang";
      return {
        kind,
        prefix,
        highlight: clean,
        suffix: "vor",
        plain: `${prefix} ${clean} vor.`,
        subline:
          "Verstehen, anwenden, bestehen — mit Transferaufgaben, Modellvergleichen und KI-Tutor für deine Klausuren.",
      };
    }

    case "zertifikat":
    case "einzelpruefung":
    default: {
      const prefix = "Bereite dich optimal auf die";
      return {
        kind: kind === "zertifikat" ? "zertifikat" : "einzelpruefung",
        prefix,
        highlight: clean,
        suffix: "vor",
        plain: `${prefix} ${clean} vor.`,
        subline:
          "Echte Prüfungsfragen, typische Fallen und gezielte Schwächenanalyse — mit persönlichem KI-Coach.",
      };
    }
  }
}

/**
 * Kompakte SEO-Title-Phrase, z. B. für <title>-Tags.
 */
export function heroSeoTitle(input: HeroPhrasingInput): string {
  const p = buildHeroPhrasing(input);
  switch (p.kind) {
    case "ausbildung":
      return `${p.highlight} Prüfungstraining — Abschlussprüfung sicher bestehen`;
    case "fortbildung":
      return `${p.highlight} — Fortbildungsprüfung sicher bestehen`;
    case "meister":
      return `${p.highlight} — Meisterprüfung sicher bestehen`;
    case "studium":
      return `${p.highlight} Klausurvorbereitung — gezielt bestehen`;
    case "zertifikat":
    case "einzelpruefung":
    default:
      return `${p.highlight} — gezielt vorbereiten und bestehen`;
  }
}
