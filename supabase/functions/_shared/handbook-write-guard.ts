/**
 * handbook-write-guard.ts — SSOT Write Guards for Handbook Generation
 *
 * Three-layer protection:
 * 1. validateGeneratedSection() — pre-write quality gate per section
 * 2. persistSectionsAtomic() — only writes validated sections
 * 3. verifyHandbookCoverage() — post-write coverage check before step=done
 *
 * SSOT shared function:
 *   isRealHandbookSection() — phase-aware section realness check
 *   Used by: post-conditions, validate-handbook, pipeline-process, integrity-check
 */

type SB = any;

// ── SSOT Phase Thresholds (v18 — shared across ALL layers) ──
export const HANDBOOK_THRESHOLDS = {
  basis: { minChars: 800, minProse: 500 },
  expanded: { minChars: 1800, minProse: 1200 },
} as const;

export type HandbookPhase = keyof typeof HANDBOOK_THRESHOLDS;

// ── Guard thresholds (v15 — Lean Basis) ──
const MIN_SECTION_CONTENT_CHARS = HANDBOOK_THRESHOLDS.basis.minChars;
const MIN_SECTION_PROSE_CHARS = HANDBOOK_THRESHOLDS.basis.minProse;
const COVERAGE_MIN_RATIO = 1.0;          // 100% of chapters must have content (hardened v8)

// ── Structural quality markers (Elite v8) ──
// Sections must contain at least some of these didactic building blocks
const STRUCTURAL_MARKERS = [
  { pattern: /prüfungsfalle|prüfungsfallen|typische fehler|häufige fehler/i, label: "Prüfungsfallen" },
  { pattern: /beispiel|berechnungsbeispiel|praxisbeispiel|fallbeispiel/i, label: "Beispiele" },
  { pattern: /musteraufgabe|musterlösung|lösungsweg|aufgabe.*lösung/i, label: "Musteraufgaben" },
  { pattern: /merke|merkregel|eselsbrücke|checkliste|zusammenfassung/i, label: "Merkschemata" },
];

// ── Placeholder patterns (shared with validate-handbook) ──
const PLACEHOLDER_PATTERNS = [
  "_Wird durch Council",
  "_Beschreibung folgt",
  "[TODO]",
  "Lorem ipsum",
  "Platzhalter",
  "Council ergänzt",
  "Council/LLM",
  "Blueprint-Analyse ergänzt",
  "Curriculum-Analyse ergänzt",
  "_(kein Inhalt)_",
  "_(nicht verfügbar)_",
  "wird durch die nächste Generierungs-Iteration",
];

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Strip markdown headings, return only prose */
function extractProse(md: string): string {
  return md
    .split("\n")
    .filter(line => !line.match(/^#{1,6}\s/) && line.trim().length > 0)
    .join("\n")
    .trim();
}

/** Check if content is essentially just headings */
function isHeadingOnly(md: string): boolean {
  const lines = md.split("\n").filter(l => l.trim().length > 0);
  if (lines.length === 0) return true;
  const headingLines = lines.filter(l => l.match(/^#{1,6}\s/));
  return headingLines.length / lines.length > 0.8;
}

export interface SectionValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * SSOT: Phase-aware section realness check.
 * ALL layers (post-conditions, validate-handbook, pipeline-process, integrity-check)
 * MUST use this instead of inline length checks.
 *
 * @param section - must have content_markdown and optionally content_tier
 * @param defaultPhase - fallback if content_tier is not set (default: "basis")
 */
export function isRealHandbookSection(
  section: { content_markdown?: string | null; content_tier?: string | null },
  defaultPhase: HandbookPhase = "basis",
): boolean {
  const md = section.content_markdown;
  if (typeof md !== "string") return false;
  const phase: HandbookPhase =
    section.content_tier === "expanded" ? "expanded" : defaultPhase;
  const threshold = HANDBOOK_THRESHOLDS[phase];
  return md.length >= threshold.minChars;
}

/**
 * Layer 1: Pre-write validation for a single section.
 * MUST pass before any DB write is attempted.
 */
export function validateGeneratedSection(section: {
  title?: string;
  content_markdown?: string;
}, opts?: { phase?: "basis" | "expand" }): SectionValidationResult {
  const phase = opts?.phase || "basis"; // v19: default=basis — lean content must pass; expand checks are explicit
  if (!isNonEmptyText(section.title)) {
    return { ok: false, reason: "section title missing" };
  }

  const md = section.content_markdown || "";

  if (!isNonEmptyText(md)) {
    return { ok: false, reason: "section content empty" };
  }

  if (md.trim().length < MIN_SECTION_CONTENT_CHARS) {
    return {
      ok: false,
      reason: `section too short: ${md.trim().length}/${MIN_SECTION_CONTENT_CHARS} chars`,
    };
  }

  if (isHeadingOnly(md)) {
    return { ok: false, reason: "section is heading-only, no prose" };
  }

  const prose = extractProse(md);
  if (prose.length < MIN_SECTION_PROSE_CHARS) {
    return {
      ok: false,
      reason: `prose too short: ${prose.length}/${MIN_SECTION_PROSE_CHARS} chars (excl. headings)`,
    };
  }

  // Check for placeholder patterns
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (md.includes(pattern)) {
      return { ok: false, reason: `placeholder detected: "${pattern}"` };
    }
  }

  // ── Elite v8 / v16-basis: Structural quality check ──
  // Expand phase: at least 2 of 4 didactic building blocks must be present
  // Basis phase: at least 1 of 4 — lean skeleton gets depth in expand pass
  const markerHits = STRUCTURAL_MARKERS.filter(m => m.pattern.test(md));
  const minMarkers = phase === "basis" ? 1 : 2;
  if (markerHits.length < minMarkers) {
    const missing = STRUCTURAL_MARKERS.filter(m => !m.pattern.test(md)).map(m => m.label);
    return {
      ok: false,
      reason: `structural quality: only ${markerHits.length}/4 didactic markers, need ${minMarkers} for ${phase} (missing: ${missing.join(", ")})`,
    };
  }

  return { ok: true };
}

/**
 * Layer 2: Filter section rows, only return those passing validation.
 * Returns { valid, rejected } for forensics.
 */
export function filterValidSections(
  sectionRows: Array<Record<string, unknown>>,
): {
  valid: Array<Record<string, unknown>>;
  rejected: Array<{ row: Record<string, unknown>; reason: string }>;
} {
  const valid: Array<Record<string, unknown>> = [];
  const rejected: Array<{ row: Record<string, unknown>; reason: string }> = [];

  for (const row of sectionRows) {
    // Respect content_tier from the row — basis content uses basis thresholds
    const tier = (row.content_tier as string) || "basis";
    const phase = tier === "expanded" ? "expand" : "basis";
    const result = validateGeneratedSection({
      title: row.title as string,
      content_markdown: row.content_markdown as string,
    }, { phase });
    if (result.ok) {
      valid.push(row);
    } else {
      rejected.push({ row, reason: result.reason! });
    }
  }

  return { valid, rejected };
}

/**
 * Layer 3: Post-write coverage verification (v20 — SSOT-aware).
 *
 * SSOT PRINCIPLE: The expected section count is derived from the same logic
 * the generator uses — max(lf_count, TARGET_CHAPTERS) — not from a separate
 * hardcoded constant. The verifier counts chapters WITH real sections,
 * not just chapters that exist.
 *
 * Call BEFORE marking generate_handbook as done.
 */
export async function verifyHandbookCoverage(
  sb: SB,
  curriculumId: string,
): Promise<{
  ok: boolean;
  coveredChapters: number;
  totalChapters: number;
  minNeeded: number;
  totalSections: number;
  totalChars: number;
  expectedSections: number;
  actualSections: number;
  details?: string;
}> {
  // Load all chapters for this curriculum
  const { data: chapters, error: chErr } = await sb
    .from("handbook_chapters")
    .select("id")
    .eq("curriculum_id", curriculumId);

  if (chErr || !chapters?.length) {
    return {
      ok: false,
      coveredChapters: 0,
      totalChapters: 0,
      minNeeded: 1,
      totalSections: 0,
      totalChars: 0,
      expectedSections: 1,
      actualSections: 0,
      details: chErr ? `DB error: ${chErr.message}` : "no chapters found",
    };
  }

  const chapterIds = chapters.map((c: any) => c.id);

  // Load all sections (include content_tier for SSOT realness check)
  const { data: sections, error: secErr } = await sb
    .from("handbook_sections")
    .select("chapter_id, content_markdown, content_tier, title, section_key")
    .in("chapter_id", chapterIds);

  if (secErr) {
    return {
      ok: false,
      coveredChapters: 0,
      totalChapters: chapters.length,
      minNeeded: 1,
      totalSections: 0,
      totalChars: 0,
      expectedSections: chapters.length,
      actualSections: 0,
      details: `sections query error: ${secErr.message}`,
    };
  }

  // Count distinct chapters with VALIDATED content using SSOT realness check
  let totalChars = 0;
  const coveredChapterIds = new Set<string>();
  let realSectionCount = 0;
  for (const sec of (sections || [])) {
    const md = (sec.content_markdown || "").trim();
    totalChars += md.length;
    if (isRealHandbookSection(sec) && sec.chapter_id) {
      coveredChapterIds.add(sec.chapter_id);
      realSectionCount++;
    }
  }

  const totalChapters = chapters.length;
  // SSOT: expected sections = total chapters (generator must produce 1 section per chapter)
  // This aligns with the generator which creates padding sections for chapters without LFs
  const expectedSections = totalChapters;
  const minNeeded = Math.max(1, Math.ceil(totalChapters * COVERAGE_MIN_RATIO));
  const coveredChapters = coveredChapterIds.size;

  return {
    ok: coveredChapters >= minNeeded,
    coveredChapters,
    totalChapters,
    minNeeded,
    totalSections: (sections || []).length,
    totalChars,
    expectedSections,
    actualSections: realSectionCount,
  };
}
