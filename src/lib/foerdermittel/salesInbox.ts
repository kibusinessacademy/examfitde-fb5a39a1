// FördermittelOS — Cut 7: Sales Inbox SSOT
// Pure, deterministic, client-safe. No network. No PII leakage.
// Owns: status flow, transition guards, priority bucketing, filter normalization,
// activity validation, PII scrub for audit payloads, follow-up due classification.

export type LeadStatus = "new" | "qualified" | "contacted" | "won" | "lost";
export type LeadActivityKind = "note" | "call" | "email" | "meeting" | "followup" | "outcome";
export type LeadTier = "cold" | "warm" | "hot";
export type LeadPriority = "p0" | "p1" | "p2" | "p3";

export const LEAD_STATUSES: readonly LeadStatus[] = [
  "new", "qualified", "contacted", "won", "lost",
];

export const LEAD_ACTIVITY_KINDS: readonly LeadActivityKind[] = [
  "note", "call", "email", "meeting", "followup", "outcome",
];

export interface SalesLeadListItem {
  id: string;
  company_name: string;
  contact_email: string;
  industry: string | null;
  source: string;
  status: LeadStatus;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
  next_action: string | null;
  next_action_at: string | null;
  assigned_to: string | null;
  score: number;
  tier: LeadTier;
  region: string | null;
  source_page: string | null;
  report_top_slugs: string[];
  report_readiness: string | null;
}

export interface SalesLeadActivity {
  kind: LeadActivityKind;
  note: string;
  at: string;
  by: string;
  next_action_at?: string | null;
}

export interface SalesLeadFilters {
  status?: LeadStatus[];
  source?: string;
  region?: string;
  industry?: string;
  search?: string;
}

// ---------- Status transitions (forward-only) ----------

const FORWARD: Record<LeadStatus, readonly LeadStatus[]> = {
  new:       ["qualified", "contacted", "won", "lost"],
  qualified: ["contacted", "won", "lost"],
  contacted: ["won", "lost"],
  won:       [],
  lost:      [],
};

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return false;
  return FORWARD[from]?.includes(to) ?? false;
}

export function nextStatusOptions(from: LeadStatus): LeadStatus[] {
  return [...(FORWARD[from] ?? [])];
}

export function isTerminal(status: LeadStatus): boolean {
  return status === "won" || status === "lost";
}

// ---------- Priority bucketing ----------

/**
 * Deterministic P0..P3 from quality score + tier + freshness of next_action.
 * P0 = act now: hot tier OR overdue followup.
 * P1 = high score (>=70) or warm with stale activity.
 * P2 = warm or aged new.
 * P3 = cold / parked.
 */
export function computePriority(args: {
  status: LeadStatus;
  tier: LeadTier;
  score: number;
  nextActionAt: string | null;
  createdAt: string;
  now?: Date;
}): LeadPriority {
  if (isTerminal(args.status)) return "p3";
  const now = (args.now ?? new Date()).getTime();

  const overdue =
    args.nextActionAt != null &&
    Date.parse(args.nextActionAt) < now;
  if (overdue) return "p0";
  if (args.tier === "hot") return "p0";
  if (args.score >= 70) return "p1";
  if (args.tier === "warm") return "p1";

  const ageDays = (now - Date.parse(args.createdAt)) / 86_400_000;
  if (args.status === "new" && ageDays >= 3 && ageDays < 14) return "p2";
  if (ageDays >= 14) return "p3";
  return "p2";
}

export function priorityRank(p: LeadPriority): number {
  return p === "p0" ? 0 : p === "p1" ? 1 : p === "p2" ? 2 : 3;
}

// ---------- Follow-up due classification ----------

export type FollowupDue = "overdue" | "today" | "soon" | "scheduled" | "none";

export function classifyFollowup(
  nextActionAt: string | null | undefined,
  now: Date = new Date(),
): FollowupDue {
  if (!nextActionAt) return "none";
  const t = Date.parse(nextActionAt);
  if (Number.isNaN(t)) return "none";
  const delta = t - now.getTime();
  if (delta < 0) return "overdue";
  if (delta < 24 * 3600_000) return "today";
  if (delta < 7 * 86_400_000) return "soon";
  return "scheduled";
}

// ---------- Filter normalization ----------

/** Strips empty / out-of-bounds values before sending to RPC. */
export function normalizeFilters(input: SalesLeadFilters): SalesLeadFilters {
  const out: SalesLeadFilters = {};
  if (input.status && input.status.length > 0) {
    out.status = input.status.filter((s): s is LeadStatus =>
      (LEAD_STATUSES as readonly string[]).includes(s),
    );
    if (out.status.length === 0) delete out.status;
  }
  if (input.source && input.source.trim()) out.source = input.source.trim().slice(0, 64);
  if (input.region && input.region.trim()) out.region = input.region.trim().slice(0, 8);
  if (input.industry && input.industry.trim()) out.industry = input.industry.trim().slice(0, 60);
  if (input.search && input.search.trim().length >= 2) out.search = input.search.trim().slice(0, 80);
  return out;
}

// ---------- Activity validation ----------

export interface ActivityDraft {
  kind: LeadActivityKind;
  note: string;
  nextActionAt?: string | null;
}

export interface ActivityValidation {
  ok: boolean;
  errors: string[];
  cleaned?: ActivityDraft;
}

const PII_PATTERNS: RegExp[] = [
  /\b[A-Z]{2}\d{2}[ ]?\d{4}[ ]?\d{4}[ ]?\d{2,}\b/, // IBAN-like
  /\b\d{16,}\b/, // long numeric ids (card)
];

export function validateActivityDraft(input: Partial<ActivityDraft>): ActivityValidation {
  const errors: string[] = [];
  const kind = (input.kind ?? "") as LeadActivityKind;
  if (!(LEAD_ACTIVITY_KINDS as readonly string[]).includes(kind)) errors.push("invalid_kind");
  const note = (input.note ?? "").trim();
  if (note.length < 2) errors.push("note_required");
  if (note.length > 2000) errors.push("note_too_long");
  if (kind === "followup" && !input.nextActionAt) errors.push("next_action_at_required");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    cleaned: {
      kind,
      note: note.slice(0, 2000),
      nextActionAt: input.nextActionAt ?? null,
    },
  };
}

// ---------- PII scrub for audit-bound payloads ----------

/**
 * Remove email-like / phone-like / IBAN-like substrings + key blocklist
 * before sending anything to audit. Idempotent.
 */
export function scrubForAudit<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const BLOCK_KEYS = new Set([
    "email", "contact_email", "phone", "contact_phone",
    "company_name", "contact_name", "notes", "note",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (BLOCK_KEYS.has(k)) continue;
    if (typeof v === "string") {
      let s = v
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted-email]")
        .replace(/\+?\d[\d\s().-]{6,}\d/g, "[redacted-phone]");
      for (const re of PII_PATTERNS) s = s.replace(re, "[redacted-id]");
      out[k] = s.slice(0, 240);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------- Status sorting helper ----------

export function sortByPriorityThenScore(items: SalesLeadListItem[]): SalesLeadListItem[] {
  const now = new Date();
  return [...items]
    .map((it) => ({
      it,
      p: computePriority({
        status: it.status,
        tier: it.tier,
        score: it.score,
        nextActionAt: it.next_action_at,
        createdAt: it.created_at,
        now,
      }),
    }))
    .sort((a, b) => {
      const pa = priorityRank(a.p);
      const pb = priorityRank(b.p);
      if (pa !== pb) return pa - pb;
      if (a.it.score !== b.it.score) return b.it.score - a.it.score;
      return Date.parse(b.it.created_at) - Date.parse(a.it.created_at);
    })
    .map((x) => x.it);
}

// ---------- Display copy ----------

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "Neu",
  qualified: "Qualifiziert",
  contacted: "Kontaktiert",
  won: "Gewonnen",
  lost: "Verloren",
};

export const STATUS_TONE: Record<LeadStatus, "primary" | "warning" | "success" | "muted" | "destructive"> = {
  new: "primary",
  qualified: "warning",
  contacted: "warning",
  won: "success",
  lost: "destructive",
};

export const PRIORITY_LABEL: Record<LeadPriority, string> = {
  p0: "P0 jetzt",
  p1: "P1 hoch",
  p2: "P2 mittel",
  p3: "P3 niedrig",
};

export const ACTIVITY_LABEL: Record<LeadActivityKind, string> = {
  note: "Notiz",
  call: "Anruf",
  email: "E-Mail",
  meeting: "Termin",
  followup: "Wiedervorlage",
  outcome: "Ergebnis",
};
