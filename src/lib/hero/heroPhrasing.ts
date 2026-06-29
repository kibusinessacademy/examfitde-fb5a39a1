/**
 * Hero Phrasing SSOT
 *
 * Eine einzige Quelle für Hero-Überschriften, Sublines und Prüfungs-Kontextsätze.
 *
 * Verhindert sprachlich falsche Sätze wie
 *   „Bestehe deine Prüfung als BWL …"
 *   „Bestehe deine Abschlussprüfung als AEVO …"
 *
 * Regel (verbindlich):
 *   Ausbildungsberuf        → „Bestehe deine Abschlussprüfung als {Beruf}."
 *   Fortbildung (IHK/HWK)   → „Bestehe deine Fortbildungsprüfung zum/zur {Abschluss}."
 *   Meister                 → „Bestehe deine Meisterprüfung zum/zur {Meisterabschluss}."
 *   Einzelprüfung / Zert.   → „Bereite dich optimal auf die {Prüfungsname} vor."
 *   Studium                 → „Bereite dich optimal auf deine Prüfungen im Studiengang {Studiengang} vor."
 *
 * Erweiterung (v2): jede Phrasing liefert zusätzlich grammatikalisch saubere
 * Hilfsphrasen, die in CTAs, Cards, Badges, FAQs und Body-Texten verwendet werden
 * MÜSSEN. Niemals selbst `${chamber}-Abschlussprüfung als ${name}` bauen.
 */

import { reportUnclassifiableHeroPhrasing } from "./unclassifiableLogger";

export type QualificationKind =
  | "ausbildung"
  | "fortbildung"
  | "meister"
  | "einzelpruefung"
  | "zertifikat"
  | "studium"
  | "unknown";

export type QualificationConnector = "als" | "zum/zur" | "im Studiengang" | null;
export type QualificationConfidence = "high" | "medium" | "low";

export interface HeroPhrasingInput {
  /** Roher Titel aus DB, z. B. „Ausbildereignungsprüfung (AEVO)" oder „Bankkaufmann/-frau (IHK)". */
  title: string;
  /** certification_catalog.catalog_type — wenn vorhanden, ist es die zuverlässigste Quelle. */
  catalogType?: string | null;
  /** Kammer-Typ (IHK, HWK, …) für Subline. */
  chamberType?: string | null;
  /** Optional: stabile ID für Logging unklassifizierbarer Datensätze. */
  recordId?: string | null;
  /** Optional: Slug für Logging. */
  slug?: string | null;
}

export interface HeroPhrasing {
  kind: QualificationKind;
  /** True, wenn weder catalog_type noch Heuristik greift. */
  isUnknown: boolean;
  /** Confidence der Klassifikation. */
  confidence: QualificationConfidence;
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

  /** Grammatikalisch korrektes Prüfungs-Substantiv, z. B. „Abschlussprüfung". */
  examNoun: string;
  /** Korrekter Konnektor zwischen Prüfung und Bezeichnung. */
  connector: QualificationConnector;
  /** Korrekter zusammengesetzter Kontext-Satz, z. B.
   *  „Abschlussprüfung als Bankkaufmann" / „Ausbildereignungsprüfung". */
  examContextPhrase: string;
  /** Kontextsatz mit Kammer, z. B. „IHK-Abschlussprüfung als Bankkaufmann". */
  chamberExamPhrase: string;
  /** Sicherer Possessiv-Kontext, z. B. „deine IHK-Abschlussprüfung als Bankkaufmann". */
  possessiveChamberPhrase: string;
  /** Kurzer Produkt-Titel-Baustein, z. B. „Prüfungstraining Bankkaufmann"
   *  bzw. „Prüfungstraining AEVO". Niemals „Prüfungstraining als …". */
  productHeading: string;
  /** Shop-Badge-Text, z. B. „IHK-Abschlussprüfung", „AEVO-Prüfung". */
  badgeLabel: string;
  /** CTA-Text, z. B. „Jetzt Abschlussprüfung trainieren". */
  ctaLabel: string;
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

interface ClassificationResult {
  kind: QualificationKind;
  confidence: QualificationConfidence;
  isUnknown: boolean;
}

/**
 * Klassifiziert die Qualifikation. catalog_type aus der DB hat Vorrang;
 * Fallback ist Heuristik auf den Titel. Liefert zusätzlich Confidence
 * + isUnknown, damit aufrufende Komponenten Fallback-Texte zeigen können.
 */
export function classifyQualificationDetailed(
  input: HeroPhrasingInput,
): ClassificationResult {
  const ct = (input.catalogType || "").toLowerCase();
  if (ct) {
    if (ct === "ausbildung") return { kind: "ausbildung", confidence: "high", isUnknown: false };
    if (ct === "meister") return { kind: "meister", confidence: "high", isUnknown: false };
    if (ct.startsWith("fortbildung")) return { kind: "fortbildung", confidence: "high", isUnknown: false };
    if (ct === "studium") return { kind: "studium", confidence: "high", isUnknown: false };
    if (ct === "sachkunde") return { kind: "einzelpruefung", confidence: "high", isUnknown: false };
    if (ct === "branchenzertifikat" || ct === "projektmanagement")
      return { kind: "zertifikat", confidence: "high", isUnknown: false };
    // "Sonstiges" (AEVO etc.) und unbekannte → Heuristik
  }

  const t = (input.title || "").toLowerCase();
  if (!t) return { kind: "unknown", confidence: "low", isUnknown: true };

  if (/\baevo\b|ausbildereignung/i.test(t)) return { kind: "einzelpruefung", confidence: "medium", isUnknown: false };
  if (/\bsachkunde|§\s*34|§34/i.test(t)) return { kind: "einzelpruefung", confidence: "medium", isUnknown: false };
  if (/\bmeister\b/i.test(t)) return { kind: "meister", confidence: "medium", isUnknown: false };
  if (/\bfachwirt\b|\bbetriebswirt\b|\bgepr(üfter|uefter)?\b/i.test(t)) return { kind: "fortbildung", confidence: "medium", isUnknown: false };
  if (/\bb\.?\s*sc\.?\b|\bm\.?\s*sc\.?\b|\bbachelor\b|\bmaster\b|\bstudiengang\b|\bbwl\b|\bvwl\b/i.test(t)) return { kind: "studium", confidence: "medium", isUnknown: false };
  if (/zertifikat|certified|certification|\baws\b|\bitil\b|\bprince2\b|\bscrum\b/i.test(t)) return { kind: "zertifikat", confidence: "medium", isUnknown: false };
  if (/kaufmann|kauffrau|kaufleute|mechaniker|elektroniker|techniker|fachkraft|fachangestellte/i.test(t)) return { kind: "ausbildung", confidence: "medium", isUnknown: false };

  return { kind: "unknown", confidence: "low", isUnknown: true };
}

/** Backwards-compat: wirft nie „unknown" zurück. */
export function classifyQualification(input: HeroPhrasingInput): Exclude<QualificationKind, "unknown"> {
  const c = classifyQualificationDetailed(input);
  return c.kind === "unknown" ? "einzelpruefung" : c.kind;
}

const TAGLINE = "– systematisch & sicher";

function endsWithPruefung(s: string): boolean {
  // Treat as already a "Prüfung" if the word appears anywhere in the title
  // (e.g. "Sachkundeprüfung §34a", "Ausbildereignungsprüfung (AEVO)").
  return /pr(üfung|uefung)/i.test(s);
}

function buildExamContext(kind: QualificationKind, clean: string): {
  examNoun: string;
  connector: QualificationConnector;
  examContextPhrase: string;
} {
  switch (kind) {
    case "ausbildung":
      return {
        examNoun: "Abschlussprüfung",
        connector: "als",
        examContextPhrase: `Abschlussprüfung als ${clean}`,
      };
    case "fortbildung":
      return {
        examNoun: "Fortbildungsprüfung",
        connector: "zum/zur",
        examContextPhrase: `Fortbildungsprüfung zum/zur ${clean}`,
      };
    case "meister":
      return {
        examNoun: "Meisterprüfung",
        connector: "zum/zur",
        examContextPhrase: `Meisterprüfung zum/zur ${clean}`,
      };
    case "studium":
      return {
        examNoun: "Prüfung",
        connector: "im Studiengang",
        examContextPhrase: `Prüfung im Studiengang ${clean}`,
      };
    case "zertifikat":
    case "einzelpruefung":
      return {
        examNoun: "Prüfung",
        connector: null,
        examContextPhrase: endsWithPruefung(clean) ? clean : `Prüfung ${clean}`,
      };
    case "unknown":
    default:
      return {
        examNoun: "Prüfung",
        connector: null,
        examContextPhrase: clean
          ? endsWithPruefung(clean) ? clean : `Prüfung ${clean}`
          : "deine Prüfung",
      };
  }
}

function buildChamberExamPhrase(
  kind: QualificationKind,
  clean: string,
  chamber: string,
): string {
  const safeChamber = chamber.trim();
  const chamberPrefix = safeChamber ? `${safeChamber}-` : "";
  switch (kind) {
    case "ausbildung":
      return `${chamberPrefix}Abschlussprüfung als ${clean}`;
    case "fortbildung":
      return `${chamberPrefix}Fortbildungsprüfung zum/zur ${clean}`;
    case "meister":
      return `${chamberPrefix}Meisterprüfung zum/zur ${clean}`;
    case "studium":
      return `Prüfung im Studiengang ${clean}`;
    case "zertifikat":
    case "einzelpruefung":
      return endsWithPruefung(clean)
        ? clean
        : safeChamber
          ? `${safeChamber}-Prüfung ${clean}`
          : `Prüfung ${clean}`;
    case "unknown":
    default:
      return clean
        ? endsWithPruefung(clean) ? clean : `Prüfung ${clean}`
        : "Prüfung";
  }
}

function buildProductHeading(kind: QualificationKind, clean: string): string {
  if (!clean) return "Prüfungstraining";
  // Niemals „Prüfungstraining als …" — immer nur „Prüfungstraining {Bezeichnung}".
  return endsWithPruefung(clean)
    ? `Training: ${clean}`
    : `Prüfungstraining ${clean}`;
}

function buildBadgeLabel(kind: QualificationKind, clean: string, chamber: string): string {
  const c = chamber.trim();
  switch (kind) {
    case "ausbildung":
      return c ? `${c}-Abschlussprüfung` : "Abschlussprüfung";
    case "fortbildung":
      return c ? `${c}-Fortbildungsprüfung` : "Fortbildungsprüfung";
    case "meister":
      return c ? `${c}-Meisterprüfung` : "Meisterprüfung";
    case "studium":
      return "Hochschulprüfung";
    case "zertifikat":
      return "Zertifizierungsprüfung";
    case "einzelpruefung":
      return endsWithPruefung(clean) ? clean : `${clean}-Prüfung`;
    case "unknown":
    default:
      return "Prüfungstraining";
  }
}

function buildCtaLabel(kind: QualificationKind): string {
  switch (kind) {
    case "ausbildung":
      return "Jetzt Abschlussprüfung trainieren";
    case "fortbildung":
      return "Jetzt Fortbildungsprüfung trainieren";
    case "meister":
      return "Jetzt Meisterprüfung trainieren";
    case "studium":
      return "Jetzt Klausuren trainieren";
    case "zertifikat":
      return "Jetzt Zertifizierung trainieren";
    case "einzelpruefung":
      return "Jetzt Prüfung trainieren";
    case "unknown":
    default:
      return "Jetzt mit dem Prüfungstraining starten";
  }
}

export function buildHeroPhrasing(input: HeroPhrasingInput): HeroPhrasing {
  const detail = classifyQualificationDetailed(input);
  const clean = cleanCourseTitle(stripChamberSuffix(input.title || ""));
  const chamber = (input.chamberType || "").trim();

  if (detail.isUnknown || detail.confidence === "low") {
    reportUnclassifiableHeroPhrasing({
      title: input.title ?? "",
      catalogType: input.catalogType ?? null,
      chamberType: input.chamberType ?? null,
      recordId: input.recordId ?? null,
      slug: input.slug ?? null,
      confidence: detail.confidence,
      isUnknown: detail.isUnknown,
    });
  }

  const ctx = buildExamContext(detail.kind, clean);
  const chamberExamPhrase = buildChamberExamPhrase(detail.kind, clean, chamber);
  const possessiveChamberPhrase = `deine ${chamberExamPhrase}`;
  const productHeading = buildProductHeading(detail.kind, clean);
  const badgeLabel = buildBadgeLabel(detail.kind, clean, chamber);
  const ctaLabel = buildCtaLabel(detail.kind);

  switch (detail.kind) {
    case "ausbildung": {
      const prefix = "Bestehe deine Abschlussprüfung als";
      return {
        kind: detail.kind,
        isUnknown: false,
        confidence: detail.confidence,
        prefix,
        highlight: clean,
        suffix: TAGLINE,
        plain: `${prefix} ${clean} ${TAGLINE}`,
        subline: chamber
          ? `Trainiere exakt das, was in der ${chamber}-Abschlussprüfung drankommt — mit echten Prüfungsaufgaben, Simulation und persönlichem KI-Prüfungscoach.`
          : `Trainiere exakt das, was in der Abschlussprüfung drankommt — mit echten Prüfungsaufgaben, Simulation und persönlichem KI-Prüfungscoach.`,
        ...ctx,
        chamberExamPhrase,
        possessiveChamberPhrase,
        productHeading,
        badgeLabel,
        ctaLabel,
      };
    }

    case "fortbildung": {
      const prefix = "Bestehe deine Fortbildungsprüfung zum/zur";
      return {
        kind: detail.kind,
        isUnknown: false,
        confidence: detail.confidence,
        prefix,
        highlight: clean,
        suffix: TAGLINE,
        plain: `${prefix} ${clean} ${TAGLINE}`,
        subline: chamber
          ? `Strukturierte Vorbereitung auf die ${chamber}-Fortbildungsprüfung — mit Fallbeispielen, Prüfungsfragen und KI-Coach.`
          : "Strukturierte Vorbereitung auf die Fortbildungsprüfung — mit Fallbeispielen, Prüfungsfragen und KI-Coach.",
        ...ctx,
        chamberExamPhrase,
        possessiveChamberPhrase,
        productHeading,
        badgeLabel,
        ctaLabel,
      };
    }

    case "meister": {
      const prefix = "Bestehe deine Meisterprüfung zum/zur";
      return {
        kind: detail.kind,
        isUnknown: false,
        confidence: detail.confidence,
        prefix,
        highlight: clean,
        suffix: TAGLINE,
        plain: `${prefix} ${clean} ${TAGLINE}`,
        subline: chamber
          ? `Gezielte Vorbereitung auf die ${chamber}-Meisterprüfung — mit Fachfragen, Fallstudien und KI-Coach.`
          : "Gezielte Vorbereitung auf die Meisterprüfung — mit Fachfragen, Fallstudien und KI-Coach.",
        ...ctx,
        chamberExamPhrase,
        possessiveChamberPhrase,
        productHeading,
        badgeLabel,
        ctaLabel,
      };
    }

    case "studium": {
      const prefix = "Bereite dich optimal auf deine Prüfungen im Studiengang";
      return {
        kind: detail.kind,
        isUnknown: false,
        confidence: detail.confidence,
        prefix,
        highlight: clean,
        suffix: "vor",
        plain: `${prefix} ${clean} vor.`,
        subline:
          "Verstehen, anwenden, bestehen — mit Transferaufgaben, Modellvergleichen und KI-Tutor für deine Klausuren.",
        ...ctx,
        chamberExamPhrase,
        possessiveChamberPhrase,
        productHeading,
        badgeLabel,
        ctaLabel,
      };
    }

    case "zertifikat":
    case "einzelpruefung": {
      const prefix = "Bereite dich optimal auf die";
      return {
        kind: detail.kind,
        isUnknown: false,
        confidence: detail.confidence,
        prefix,
        highlight: clean,
        suffix: "vor",
        plain: `${prefix} ${clean} vor.`,
        subline:
          "Echte Prüfungsfragen, typische Fallen und gezielte Schwächenanalyse — mit persönlichem KI-Coach.",
        ...ctx,
        chamberExamPhrase,
        possessiveChamberPhrase,
        productHeading,
        badgeLabel,
        ctaLabel,
      };
    }

    case "unknown":
    default: {
      const safeHighlight = clean || "deine Prüfung";
      const prefix = "Bereite dich gezielt auf";
      return {
        kind: "unknown",
        isUnknown: true,
        confidence: detail.confidence,
        prefix,
        highlight: safeHighlight,
        suffix: "vor",
        plain: `${prefix} ${safeHighlight} vor.`,
        subline:
          "Wir bereiten dich strukturiert auf deine Prüfung vor — mit prüfungsnahen Aufgaben und persönlichem KI-Coach.",
        ...ctx,
        chamberExamPhrase,
        possessiveChamberPhrase,
        productHeading,
        badgeLabel,
        ctaLabel,
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
      return `${p.highlight} — gezielt vorbereiten und bestehen`;
    case "unknown":
    default:
      return `${p.highlight || "Prüfungstraining"} — strukturiert vorbereiten`;
  }
}
