// FördermittelOS Cut 5 — SEO Authority Engine SSOT
// Pure, deterministic, client-safe. No network, no AI, no crawler.
// Consumes Cuts 1-4 (Registry + Matching + Freshness + Execution + CoPilot context).

import type { Program, ProgramTopic, Region, CompanySize } from "./types";
import { classifyFreshness, summarizeProgramFreshness } from "./freshness";

/* ------------------------------------------------------------------ */
/* Cluster taxonomy                                                   */
/* ------------------------------------------------------------------ */

export type ClusterKind =
  | "state"
  | "topic"
  | "industry"
  | "size"
  | "combination"
  | "antrag"
  | "aktuell";

export interface ClusterMeta {
  kind: ClusterKind;
  key: string;
  /** SEO-stable slug used in URL */
  slug: string;
  title: string;
  /** ≤ 160 chars meta description */
  description: string;
  canonicalPath: string;
  h1: string;
  lead: string;
  /** SEO long-tail keywords this cluster targets */
  keywords: string[];
}

export interface Cluster {
  meta: ClusterMeta;
  /** Programs anchored to this cluster (>= 1 required for indexable page) */
  programs: Program[];
  /** Bridge candidates: related clusters to surface as internal links */
  relatedStates: Region[];
  relatedTopics: ProgramTopic[];
  relatedIndustries: string[];
  relatedCombinations: string[];
  /** Authority signal 0..100 — drives "should-be-indexed" decision */
  authorityScore: number;
  /** True if cluster is too thin to safely index */
  isThin: boolean;
}

export const STATE_LABEL: Record<Region, string> = {
  DE: "Deutschland (Bund)",
  EU: "EU",
  BW: "Baden-Württemberg",
  BY: "Bayern",
  BE: "Berlin",
  BB: "Brandenburg",
  HB: "Bremen",
  HH: "Hamburg",
  HE: "Hessen",
  MV: "Mecklenburg-Vorpommern",
  NI: "Niedersachsen",
  NW: "Nordrhein-Westfalen",
  RP: "Rheinland-Pfalz",
  SL: "Saarland",
  SN: "Sachsen",
  ST: "Sachsen-Anhalt",
  SH: "Schleswig-Holstein",
  TH: "Thüringen",
};

/** Industry inference from topics — deterministic, conservative. */
export const INDUSTRY_TOPIC_MAP: Record<string, ProgramTopic[]> = {
  it: ["digitalisierung", "ki", "innovation"],
  handwerk: ["energie", "nachhaltigkeit", "weiterbildung", "ausbildung"],
  produktion: ["digitalisierung", "energie", "innovation"],
  handel: ["digitalisierung", "weiterbildung"],
  gesundheit: ["weiterbildung", "ausbildung", "personal"],
  bildung: ["weiterbildung", "ausbildung"],
  energie: ["energie", "nachhaltigkeit", "innovation"],
  gruendung: ["gruendung", "innovation"],
};

export const INDUSTRY_LABEL: Record<string, string> = {
  it: "IT & Software",
  handwerk: "Handwerk",
  produktion: "Produktion & Industrie",
  handel: "Handel & E-Commerce",
  gesundheit: "Gesundheit & Pflege",
  bildung: "Bildung & Träger",
  energie: "Energie & Cleantech",
  gruendung: "Gründung & Startups",
};

/* ------------------------------------------------------------------ */
/* Builders                                                           */
/* ------------------------------------------------------------------ */

const MIN_PROGRAMS_INDEXABLE = 1;

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

/** Authority score — penalises thin / stale / single-source clusters. */
export function computeSeoAuthorityScore(cluster: {
  programs: Program[];
}): number {
  const programs = cluster.programs;
  if (programs.length === 0) return 0;

  const base = Math.min(40, programs.length * 8);
  const activeShare =
    programs.filter((p) => p.status === "active").length / programs.length;
  const activeBoost = Math.round(activeShare * 25);

  const fresh = summarizeProgramFreshness(programs);
  const freshShare = fresh.total > 0 ? fresh.fresh / fresh.total : 0;
  const freshBoost = Math.round(freshShare * 15);

  const authorities = new Set(programs.map((p) => p.authority));
  const diversityBoost = Math.min(10, authorities.size * 3);

  const topicSet = new Set(programs.flatMap((p) => p.topics));
  const topicBoost = Math.min(10, topicSet.size * 2);

  return clamp(base + activeBoost + freshBoost + diversityBoost + topicBoost);
}

function isThin(programs: Program[]): boolean {
  if (programs.length < MIN_PROGRAMS_INDEXABLE) return true;
  // Stale-only single-program clusters → thin
  if (programs.length === 1 && classifyFreshness(programs[0]) === "stale") return true;
  return false;
}

function relatedStates(programs: Program[]): Region[] {
  return Array.from(new Set(programs.map((p) => p.region)));
}
function relatedTopics(programs: Program[]): ProgramTopic[] {
  return Array.from(new Set(programs.flatMap((p) => p.topics)));
}
function relatedCombinationsOf(programs: Program[]): string[] {
  const out = new Set<string>();
  for (const p of programs) (p.combinableWith ?? []).forEach((s) => out.add(s));
  return Array.from(out);
}
function relatedIndustriesOf(programs: Program[]): string[] {
  const topics = new Set(programs.flatMap((p) => p.topics));
  return Object.entries(INDUSTRY_TOPIC_MAP)
    .filter(([, ts]) => ts.some((t) => topics.has(t)))
    .map(([k]) => k);
}

/* ------- per-kind builders ------- */

export function buildStateCluster(programs: Program[], state: Region): Cluster {
  const filtered = programs.filter((p) => p.region === state || p.region === "DE");
  const label = STATE_LABEL[state] ?? state;
  return finalize({
    kind: "state",
    key: state,
    slug: slug(state),
    title: `Fördermittel ${label} — Programme, Zuschüsse & Antrag`,
    description: `Aktuelle Förderprogramme für Unternehmen in ${label}. Bund + Land kombinieren, Antrag vorbereiten, Aktualitäts-Score je Programm.`,
    canonicalPath: `/foerdermittel/bundesland/${slug(state)}`,
    h1: `Förderprogramme in ${label}`,
    lead: `Bund- und Landesförderungen für Unternehmen mit Sitz oder Betriebsstätte in ${label} — laufend auf Aktualität geprüft.`,
    keywords: [
      `fördermittel ${label.toLowerCase()}`,
      `zuschüsse ${label.toLowerCase()}`,
      `landesförderung ${label.toLowerCase()}`,
      `förderprogramme ${label.toLowerCase()}`,
    ],
  }, filtered);
}

export function buildTopicCluster(programs: Program[], topic: ProgramTopic): Cluster {
  const filtered = programs.filter((p) => p.topics.includes(topic));
  return finalize({
    kind: "topic",
    key: topic,
    slug: topic,
    title: `Förderungen ${topic} — Zuschüsse & Programme im Überblick`,
    description: `Förderprogramme für ${topic}: Bund, Länder, EU. Fit-Score, Bewilligungs­wahrscheinlichkeit, Aktualitäts-Status pro Programm.`,
    canonicalPath: `/foerdermittel/thema/${topic}`,
    h1: `Förderungen: ${topic}`,
    lead: `Strukturierte Übersicht aller relevanten Förderprogramme zum Thema ${topic} — mit FörderRadar.`,
    keywords: [`förderung ${topic}`, `zuschuss ${topic}`, `förderprogramm ${topic}`],
  }, filtered);
}

export function buildIndustryCluster(programs: Program[], industry: string): Cluster {
  const topics = INDUSTRY_TOPIC_MAP[industry] ?? [];
  const filtered = programs.filter((p) => p.topics.some((t) => topics.includes(t)));
  const label = INDUSTRY_LABEL[industry] ?? industry;
  return finalize({
    kind: "industry",
    key: industry,
    slug: industry,
    title: `Fördermittel ${label} — Programme & Zuschüsse für die Branche`,
    description: `Förderprogramme für ${label}: passende Bund-, Landes- und Spezialprogramme inkl. Bewilligungs­wahrscheinlichkeit.`,
    canonicalPath: `/foerdermittel/branche/${industry}`,
    h1: `Förderprogramme für ${label}`,
    lead: `Die relevantesten Förderungen für Unternehmen aus dem Bereich ${label} — gefiltert nach passenden Themenfeldern.`,
    keywords: [
      `fördermittel ${label.toLowerCase()}`,
      `förderprogramme ${label.toLowerCase()}`,
      `branche ${label.toLowerCase()} förderung`,
    ],
  }, filtered);
}

export interface CombinationDef {
  slug: string;
  label: string;
  description: string;
  programSlugs: string[];
}

/** Curated combination clusters — only kombinierbare Pakete. */
export const COMBINATIONS: CombinationDef[] = [
  {
    slug: "digitalisierung-bund-land",
    label: "Digitalisierung: Bund + Land kombinieren",
    description:
      "Wie sich Bundes- und Landesförderung für Digitalisierungsvorhaben sinnvoll stapeln lassen.",
    programSlugs: ["go-digital", "digitalbonus-nrw", "digitalisierungspraemie-bw", "digitalbonus-bayern"],
  },
  {
    slug: "energie-beratung-investition",
    label: "Energie: Beratung + Investition kombinieren",
    description:
      "Erst Energieberatung fördern lassen, dann Investitionszuschuss für Wärmepumpe / Effizienz.",
    programSlugs: ["bafa-energieberatung-mittelstand", "bafa-waermepumpe"],
  },
  {
    slug: "ausbildung-und-weiterbildung",
    label: "Ausbildung & Weiterbildung gleichzeitig fördern",
    description:
      "Ausbildungsprämie für Azubis plus Qualifizierungschancengesetz für Bestandsbelegschaft.",
    programSlugs: ["ausbildungspraemie", "qualifizierungschancengesetz"],
  },
];

export function buildCombinationCluster(
  programs: Program[],
  def: CombinationDef,
): Cluster {
  const filtered = programs.filter((p) => def.programSlugs.includes(p.slug));
  return finalize({
    kind: "combination",
    key: def.slug,
    slug: def.slug,
    title: `${def.label} — Förderkombination`,
    description: def.description,
    canonicalPath: `/foerdermittel/kombination/${def.slug}`,
    h1: def.label,
    lead: def.description,
    keywords: [
      "förderung kombinieren",
      "förderprogramme stapeln",
      `${def.slug.replace(/-/g, " ")}`,
    ],
  }, filtered);
}

/* ------- antrag / aktuell (special clusters) ------- */

export function buildAntragChecklistCluster(programs: Program[]): Cluster {
  return finalize({
    kind: "antrag",
    key: "checkliste",
    slug: "checkliste",
    title: "Förderantrag-Checkliste — Unterlagen, Fristen, Reihenfolge",
    description:
      "Welche Unterlagen brauche ich? In welcher Reihenfolge? Antragscheckliste über alle Förderprogramme hinweg.",
    canonicalPath: "/foerdermittel/antrag/checkliste",
    h1: "Förderantrag-Checkliste",
    lead:
      "Pflicht-Unterlagen, Reihenfolge und typische Risiken bei Förderanträgen — aggregiert aus allen Programmen im Index.",
    keywords: [
      "förderantrag checkliste",
      "unterlagen förderantrag",
      "fördermittel antrag vorbereiten",
    ],
  }, programs);
}

export function buildAktuellCluster(programs: Program[]): Cluster {
  const filtered = programs.filter((p) => {
    const f = classifyFreshness(p);
    return f === "fresh" || f === "watch";
  });
  return finalize({
    kind: "aktuell",
    key: "aktuell",
    slug: "aktuell",
    title: "FörderRadar — Aktuelle & neue Förderprogramme",
    description:
      "Aktuell laufende und kürzlich aktualisierte Förderprogramme. Transparent geprüft, mit Aktualitäts-Status.",
    canonicalPath: "/foerdermittel/aktuell",
    h1: "FörderRadar — Aktuelle Programme",
    lead:
      "Welche Förderprogramme sind aktuell, welche pausiert, welche brauchen ein Quellen-Update — der laufend gepflegte Radar.",
    keywords: [
      "aktuelle förderprogramme",
      "neue förderung 2026",
      "förderradar",
      "fördermittel änderungen",
    ],
  }, filtered);
}

/* ------- generic finalize ------- */

function finalize(meta: ClusterMeta, programs: Program[]): Cluster {
  const cluster: Cluster = {
    meta,
    programs,
    relatedStates: relatedStates(programs),
    relatedTopics: relatedTopics(programs),
    relatedIndustries: relatedIndustriesOf(programs),
    relatedCombinations: COMBINATIONS
      .filter((c) => programs.some((p) => c.programSlugs.includes(p.slug)))
      .filter((c) => c.slug !== meta.slug)
      .map((c) => c.slug),
    authorityScore: 0,
    isThin: isThin(programs),
  };
  cluster.authorityScore = computeSeoAuthorityScore(cluster);
  return cluster;
}

/* ------------------------------------------------------------------ */
/* Gap detection + recommendations                                    */
/* ------------------------------------------------------------------ */

export interface ClusterGap {
  kind: ClusterKind;
  key: string;
  reason: "no-programs" | "thin" | "stale-only";
  detail: string;
}

export function detectClusterGaps(programs: Program[]): ClusterGap[] {
  const gaps: ClusterGap[] = [];

  for (const state of Object.keys(STATE_LABEL) as Region[]) {
    const c = buildStateCluster(programs, state);
    if (c.programs.length === 0)
      gaps.push({ kind: "state", key: state, reason: "no-programs",
        detail: `Kein einziges Programm für ${STATE_LABEL[state]} im Index.` });
    else if (c.isThin)
      gaps.push({ kind: "state", key: state, reason: "thin",
        detail: `Nur ${c.programs.length} Programm(e) für ${STATE_LABEL[state]}.` });
  }
  for (const ind of Object.keys(INDUSTRY_LABEL)) {
    const c = buildIndustryCluster(programs, ind);
    if (c.programs.length === 0)
      gaps.push({ kind: "industry", key: ind, reason: "no-programs",
        detail: `Keine Programme für Branche ${INDUSTRY_LABEL[ind]}.` });
  }
  for (const def of COMBINATIONS) {
    const c = buildCombinationCluster(programs, def);
    if (c.programs.length < 2)
      gaps.push({ kind: "combination", key: def.slug, reason: "thin",
        detail: `Kombination ${def.label}: nur ${c.programs.length} Programme verfügbar.` });
  }
  return gaps;
}

export interface InternalLink {
  href: string;
  label: string;
  reason: string;
}

export function recommendInternalLinks(cluster: Cluster, programs: Program[]): InternalLink[] {
  const out: InternalLink[] = [];

  // Programme im Cluster
  for (const p of cluster.programs.slice(0, 6)) {
    out.push({
      href: `/foerdermittel/programm/${p.slug}`,
      label: p.name,
      reason: "Programm im Cluster",
    });
  }
  // Themen
  for (const t of cluster.relatedTopics.slice(0, 4)) {
    if (cluster.meta.kind === "topic" && cluster.meta.key === t) continue;
    out.push({
      href: `/foerdermittel/thema/${t}`,
      label: `Thema: ${t}`,
      reason: "Verwandtes Themenfeld",
    });
  }
  // Bundesländer
  for (const s of cluster.relatedStates.slice(0, 4)) {
    if (cluster.meta.kind === "state" && cluster.meta.key === s) continue;
    out.push({
      href: `/foerdermittel/bundesland/${s.toLowerCase()}`,
      label: `Land: ${STATE_LABEL[s]}`,
      reason: "Programme aus diesem Bundesland",
    });
  }
  // Branchen
  for (const ind of cluster.relatedIndustries.slice(0, 3)) {
    if (cluster.meta.kind === "industry" && cluster.meta.key === ind) continue;
    out.push({
      href: `/foerdermittel/branche/${ind}`,
      label: `Branche: ${INDUSTRY_LABEL[ind]}`,
      reason: "Passt thematisch zur Branche",
    });
  }
  // Kombinationen
  for (const ck of cluster.relatedCombinations.slice(0, 3)) {
    out.push({
      href: `/foerdermittel/kombination/${ck}`,
      label: `Kombination: ${ck}`,
      reason: "Förderungen stapeln",
    });
  }
  // Fallback Antrag
  out.push({
    href: "/foerdermittel/antrag/checkliste",
    label: "Antrags-Checkliste",
    reason: "Nächster sinnvoller Schritt",
  });
  // dedupe
  const seen = new Set<string>();
  return out.filter((l) => (seen.has(l.href) ? false : (seen.add(l.href), true)));
}

/* ------------------------------------------------------------------ */
/* FAQs (visible UI only — NOT injected as JSON-LD to avoid           */
/* citation contract of the schema SSOT)                              */
/* ------------------------------------------------------------------ */

export interface ClusterFaq { q: string; a: string }

export function buildSeoFaqs(cluster: Cluster): ClusterFaq[] {
  const n = cluster.programs.length;
  const label = cluster.meta.h1;
  const out: ClusterFaq[] = [];

  out.push({
    q: `Wie viele Förderprogramme listet ${label}?`,
    a: `Aktuell ${n} Programm(e). Wir indexieren nur Cluster mit mindestens einem passenden Programm — keine leeren SEO-Seiten.`,
  });
  out.push({
    q: `Wie aktuell sind die Förderprogramme?`,
    a: `Jedes Programm trägt einen sichtbaren Aktualitäts-Status (fresh / watch / stale / unknown). Vor jeder Antragstellung gilt: offizielle Quelle der Förderstelle prüfen.`,
  });
  if (cluster.meta.kind === "state") {
    out.push({
      q: `Kann ich Bundes- und Landesförderung kombinieren?`,
      a: `Ja, oft sind Bund- und Landesprogramme stapelbar — aber nicht immer. Die Kombinations-Cluster zeigen geprüfte Pakete.`,
    });
  }
  if (cluster.meta.kind === "combination") {
    out.push({
      q: `Was muss ich bei der Kombination beachten?`,
      a: `Förderkombinationen unterliegen Beihilferecht. Nicht jede Kombination ist zulässig — die Anti-Doppelförderungs-Regeln einzelner Programme sind verbindlich.`,
    });
  }
  out.push({
    q: `Ersetzt FördermittelOS eine Förderberatung?`,
    a: `Nein. FördermittelOS ist eine strukturierte Vorbereitung — eine verbindliche Förderberatung ersetzt es nicht.`,
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Cluster meta (canonical, title, robots)                            */
/* ------------------------------------------------------------------ */

export interface ClusterHeadMeta {
  title: string;
  description: string;
  canonicalUrl: string;
  /** robots directive — `index,follow` only when not thin */
  robots: "index,follow" | "noindex,follow";
}

const APEX = "https://berufos.com";

export function buildClusterMeta(cluster: Cluster): ClusterHeadMeta {
  return {
    title: cluster.meta.title,
    description: cluster.meta.description.slice(0, 160),
    canonicalUrl: `${APEX}${cluster.meta.canonicalPath}`,
    robots: cluster.isThin ? "noindex,follow" : "index,follow",
  };
}

/* ------------------------------------------------------------------ */
/* Sizes — re-exported for ease of consumption                        */
/* ------------------------------------------------------------------ */

export const SIZE_LABEL: Record<CompanySize, string> = {
  solo: "Solo-Selbstständige",
  micro: "Kleinstunternehmen",
  small: "Kleinunternehmen",
  medium: "Mittelunternehmen",
  large: "Großunternehmen",
};
