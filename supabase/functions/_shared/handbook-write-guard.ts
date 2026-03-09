/**
 * handbook-write-guard.ts — SSOT Write Guards for Handbook Generation
 *
 * Three-layer protection:
 * 1. validateGeneratedSection() — pre-write quality gate per section
 * 2. persistSectionsAtomic() — only writes validated sections
 * 3. verifyHandbookCoverage() — post-write coverage check before step=done
 */

type SB = any;

// ── Guard thresholds ──
const MIN_SECTION_CONTENT_CHARS = 500;   // Generator guard: absolute minimum
const MIN_SECTION_PROSE_CHARS = 300;     // Prose only (excl. headings)
const COVERAGE_MIN_RATIO = 0.6;          // 60% of chapters must have content

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
 * Layer 1: Pre-write validation for a single section.
 * MUST pass before any DB write is attempted.
 */
export function validateGeneratedSection(section: {
  title?: string;
  content_markdown?: string;
}): SectionValidationResult {
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
    const result = validateGeneratedSection({
      title: row.title as string,
      content_markdown: row.content_markdown as string,
    });
    if (result.ok) {
      valid.push(row);
    } else {
      rejected.push({ row, reason: result.reason! });
    }
  }

  return { valid, rejected };
}

/**
 * Layer 3: Post-write coverage verification.
 * Checks that enough chapters have real content in the DB.
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
  totalChars: number;
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
      totalChars: 0,
      details: chErr ? `DB error: ${chErr.message}` : "no chapters found",
    };
  }

  const chapterIds = chapters.map((c: any) => c.id);

  // Load all sections
  const { data: sections, error: secErr } = await sb
    .from("handbook_sections")
    .select("chapter_id, content_markdown, title, section_key")
    .in("chapter_id", chapterIds);

  if (secErr) {
    return {
      ok: false,
      coveredChapters: 0,
      totalChapters: chapters.length,
      minNeeded: 1,
      totalChars: 0,
      details: `sections query error: ${secErr.message}`,
    };
  }

  // Count distinct chapters with VALIDATED content (same guard as pre-write)
  let totalChars = 0;
  const coveredChapterIds = new Set<string>();
  for (const sec of (sections || [])) {
    const md = (sec.content_markdown || "").trim();
    totalChars += md.length;
    const result = validateGeneratedSection({
      title: sec.title ?? sec.section_key ?? "section",
      content_markdown: sec.content_markdown,
    });
    if (result.ok && sec.chapter_id) {
      coveredChapterIds.add(sec.chapter_id);
    }
  }

  const totalChapters = chapters.length;
  const minNeeded = Math.max(1, Math.ceil(totalChapters * COVERAGE_MIN_RATIO));
  const coveredChapters = coveredChapterIds.size;

  return {
    ok: coveredChapters >= minNeeded,
    coveredChapters,
    totalChapters,
    minNeeded,
    totalChars,
  };
}
