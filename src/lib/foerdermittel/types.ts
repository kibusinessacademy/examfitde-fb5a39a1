// FördermittelOS — Single Source of Truth types
// Programme Knowledge Graph entity model.

export type Region =
  | "DE"
  | "EU"
  | "BW" | "BY" | "BE" | "BB" | "HB" | "HH" | "HE" | "MV"
  | "NI" | "NW" | "RP" | "SL" | "SN" | "ST" | "SH" | "TH";

export type CompanySize = "solo" | "micro" | "small" | "medium" | "large";

export type ProgramTopic =
  | "digitalisierung"
  | "ki"
  | "weiterbildung"
  | "ausbildung"
  | "energie"
  | "nachhaltigkeit"
  | "innovation"
  | "gruendung"
  | "export"
  | "personal";

export type ProgramKind = "zuschuss" | "darlehen" | "buergschaft" | "beratung" | "steuer";

export type ProgramStatus = "active" | "paused" | "depleted" | "expired" | "upcoming";

export type ProgramAuthority =
  | "BAFA" | "KfW" | "BMWK" | "BMAS" | "BMBF"
  | "WIBank" | "L-Bank" | "NRW.Bank" | "SAB" | "IB.SH" | "IFB" | "ILB" | "NBank"
  | "EU-KOM" | "IHK" | "HWK" | "Land" | "Sonstige";

export interface ProgramFundingRange {
  /** % subsidy of eligible costs */
  ratePctMin?: number;
  ratePctMax?: number;
  /** EUR amount caps */
  amountEurMin?: number;
  amountEurMax?: number;
}

export interface ProgramRequirement {
  key: string;
  label: string;
  /** soft requirement = warning if unmet, hard = disqualification */
  hard: boolean;
}

export interface ProgramSource {
  url: string;
  label: string;
  /** ISO date when last verified (manual or by ingestion pipeline) */
  lastVerifiedAt?: string;
  /** Marks the source as the official, primary reference (not press / aggregator) */
  official?: boolean;
}

export type FreshnessStatus = "fresh" | "watch" | "stale" | "unknown";
export type ChangeRisk = "low" | "medium" | "high";
export type UpdateCadence = "weekly" | "monthly" | "quarterly" | "yearly" | "ad-hoc";

export interface ProgramFreshness {
  sourceUrl?: string;
  sourceName?: string;
  /** ISO date of last manual/pipeline verification of the program data */
  lastVerifiedAt?: string;
  /** ISO date of last detected program change (e.g. rate, deadline, status) */
  lastChangedAt?: string;
  /** ISO date when next review is recommended */
  nextReviewAt?: string;
  /** Update rhythm we expect from the responsible authority */
  updateCadence?: UpdateCadence;
  /** Editorial notes regarding verification state */
  verificationNotes?: string;
  /** Must be cross-checked against the official source before application */
  officialSourceRequired?: boolean;
}

export interface Program {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  authority: ProgramAuthority;
  region: Region;
  topics: ProgramTopic[];
  kind: ProgramKind;
  status: ProgramStatus;
  funding: ProgramFundingRange;
  eligibleCompanySizes: CompanySize[];
  /** ISO date — null = open-ended */
  deadline?: string | null;
  /** Months until funds typically run out historically; informational */
  budgetTensionPct?: number;
  combinableWith?: string[]; // program slugs known to be combinable
  notCombinableWith?: string[];
  requirements: ProgramRequirement[];
  documentsNeeded: string[];
  /** typical decision time in weeks (estimated) */
  decisionWeeks?: number;
  /** Historical approval rate when known (0..1) — used in probability engine */
  historicalApprovalRate?: number;
  sources: ProgramSource[];
  /** SEO long-tail keywords this program ranks for */
  seoKeywords?: string[];
  /** Cut 2: Freshness & change-detection metadata */
  freshness?: ProgramFreshness;
}

export interface CompanyProfile {
  region: Region;
  industry?: string;
  size: CompanySize;
  employees?: number;
  revenueEur?: number;
  topics: ProgramTopic[];
  notes?: string;
}

export interface ProgramMatch {
  program: Program;
  /** 0..100 fit score */
  fit: number;
  /** 0..100 estimated approval probability */
  probability: number;
  /** ranked reasons explaining the score */
  reasons: string[];
  warnings: string[];
  /** hard disqualifiers (if any) — match still shown but marked */
  disqualifiers: string[];
}
