/**
 * ensureExamPartMappings — Deterministic, Idempotent, Fail-Closed
 *
 * SSOT: learning_fields.exam_part → exam_part_mappings (materialized derivation)
 * 
 * This hook guarantees that exam_part_mappings exist for a curriculum
 * BEFORE any exam-chain steps run (blueprints, pool, publish).
 * 
 * Rules:
 * - Deterministic: derived purely from learning_fields.exam_part, no AI/guessing
 * - Idempotent: safe to call multiple times, skips already-mapped LFs
 * - Fail-closed: blocks if source data is missing/inconsistent
 * - Auditable: returns typed result with reason codes
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type SB = ReturnType<typeof createClient>;

// Valid exam_part values (SSOT)
const VALID_EXAM_PARTS = ["AP1", "AP2", "Teil 1", "Teil 2", "GP1", "GP2"] as const;
type ValidExamPart = typeof VALID_EXAM_PARTS[number];

// Normalized mapping: various spellings → canonical form
const EXAM_PART_NORMALIZE: Record<string, string> = {
  "ap1": "AP1",
  "ap2": "AP2",
  "teil 1": "Teil 1",
  "teil 2": "Teil 2",
  "teil1": "Teil 1",
  "teil2": "Teil 2",
  "gp1": "GP1",
  "gp2": "GP2",
  "gestreckte abschlussprüfung teil 1": "Teil 1",
  "gestreckte abschlussprüfung teil 2": "Teil 2",
  "abschlussprüfung teil 1": "Teil 1",
  "abschlussprüfung teil 2": "Teil 2",
  "part 1": "Teil 1",
  "part 2": "Teil 2",
};

export type EnsureResult =
  | { status: "created"; created: number; skipped: number; total_lfs: number }
  | { status: "already_present"; existing: number; total_lfs: number }
  | { status: "drift_detected"; existing: number; total_lfs: number; drift: { mismatches: number; unmapped: number; orphaned: number } }
  | { status: "blocked_missing_source_data"; reason: string; details: Record<string, unknown> }
  | { status: "blocked_partial_source_data"; reason: string; details: Record<string, unknown> }
  | { status: "inconsistent_source_data"; reason: string; details: Record<string, unknown> };

function normalizeExamPart(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const lower = raw.trim().toLowerCase();
  return EXAM_PART_NORMALIZE[lower] || raw.trim();
}

function isValidExamPart(value: string): boolean {
  return (VALID_EXAM_PARTS as readonly string[]).includes(value);
}

/**
 * Default weight derivation: equal distribution within each exam_part group.
 * E.g., if 4 LFs map to AP1 and 6 to AP2:
 *   AP1 weight = 100/4 = 25 each
 *   AP2 weight = 100/6 ≈ 16.67 each
 * Weights are percentages within each exam_part (summing to 100 per part).
 */
function computeDefaultWeights(
  lfs: Array<{ id: string; exam_part: string }>,
): Map<string, number> {
  const partGroups = new Map<string, string[]>();
  for (const lf of lfs) {
    const group = partGroups.get(lf.exam_part) || [];
    group.push(lf.id);
    partGroups.set(lf.exam_part, group);
  }

  const weights = new Map<string, number>();
  for (const [, ids] of partGroups) {
    const weight = Math.round((100 / ids.length) * 100) / 100; // 2 decimals
    for (const id of ids) {
      weights.set(id, weight);
    }
  }
  return weights;
}

export async function ensureExamPartMappings(
  sb: SB,
  curriculumId: string,
): Promise<EnsureResult> {
  const tag = "[ensureExamPartMappings]";

  // ── 1) Load all learning_fields for this curriculum ──
  const { data: lfs, error: lfErr } = await sb
    .from("learning_fields")
    .select("id, code, title, exam_part")
    .eq("curriculum_id", curriculumId)
    .order("code");

  if (lfErr) {
    throw new Error(`${tag} Failed to load learning_fields: ${lfErr.message}`);
  }

  if (!lfs || lfs.length === 0) {
    return {
      status: "blocked_missing_source_data",
      reason: "No learning_fields found for curriculum",
      details: { curriculum_id: curriculumId },
    };
  }

  // ── 2) Validate exam_part source data ──
  const withExamPart: Array<{ id: string; code: string; exam_part: string }> = [];
  const withoutExamPart: Array<{ id: string; code: string }> = [];
  const invalidExamPart: Array<{ id: string; code: string; raw_value: string }> = [];

  for (const lf of lfs) {
    const normalized = normalizeExamPart(lf.exam_part);
    if (!normalized) {
      withoutExamPart.push({ id: lf.id, code: lf.code });
    } else if (!isValidExamPart(normalized)) {
      invalidExamPart.push({ id: lf.id, code: lf.code, raw_value: lf.exam_part });
    } else {
      withExamPart.push({ id: lf.id, code: lf.code, exam_part: normalized });
    }
  }

  // Fail-closed: if NO learning fields have exam_part → block
  if (withExamPart.length === 0) {
    return {
      status: "blocked_missing_source_data",
      reason: "No learning_fields have exam_part set",
      details: {
        curriculum_id: curriculumId,
        total_lfs: lfs.length,
        missing_codes: withoutExamPart.map((l) => l.code),
      },
    };
  }

  // Fail-closed: invalid values → block
  if (invalidExamPart.length > 0) {
    return {
      status: "inconsistent_source_data",
      reason: `${invalidExamPart.length} learning_fields have invalid exam_part values`,
      details: {
        curriculum_id: curriculumId,
        invalid: invalidExamPart.map((l) => ({ code: l.code, value: l.raw_value })),
        valid_values: [...VALID_EXAM_PARTS],
      },
    };
  }

  // Partial coverage: block if below threshold (< 50% of LFs have exam_part)
  if (withoutExamPart.length > 0) {
    const coveragePct = (withExamPart.length / lfs.length) * 100;
    if (coveragePct < 50) {
      return {
        status: "blocked_partial_source_data",
        reason: `Only ${coveragePct.toFixed(1)}% of learning_fields have exam_part (min 50%)`,
        details: {
          curriculum_id: curriculumId,
          total_lfs: lfs.length,
          with_exam_part: withExamPart.length,
          without_exam_part: withoutExamPart.length,
          missing_codes: withoutExamPart.map((l) => l.code),
        },
      };
    }
    console.warn(
      `${tag} ${withoutExamPart.length}/${lfs.length} LFs without exam_part ` +
      `(codes: ${withoutExamPart.map((l) => l.code).join(", ")}). ` +
      `Only mapping LFs with valid exam_part.`
    );
  }

  // ── 3) Check existing mappings (idempotency + drift verification) ──
  const { data: existingMappings } = await sb
    .from("exam_part_mappings")
    .select("id, learning_field_id, exam_part")
    .eq("curriculum_id", curriculumId);

  const existingSet = new Set((existingMappings || []).map((m: any) => m.learning_field_id));

  const toCreate = withExamPart.filter((lf) => !existingSet.has(lf.id));

  if (toCreate.length === 0) {
    // ── Drift verification: don't return already_present if mappings are inconsistent ──
    const lfMap = new Map(withExamPart.map((lf) => [lf.id, lf.exam_part]));
    const mappingByLf = new Map((existingMappings || []).map((m: any) => [m.learning_field_id, m]));
    let mismatches = 0;
    let orphaned = 0;

    for (const [lfId, expectedPart] of lfMap) {
      const mapping = mappingByLf.get(lfId);
      if (mapping && mapping.exam_part !== expectedPart) mismatches++;
    }
    for (const m of (existingMappings || [])) {
      if (!lfMap.has(m.learning_field_id)) orphaned++;
    }

    if (mismatches > 0 || orphaned > 0) {
      console.warn(
        `${tag} Drift detected for curriculum ${curriculumId}: ${mismatches} mismatches, ${orphaned} orphaned`
      );
      return {
        status: "drift_detected",
        existing: existingSet.size,
        total_lfs: lfs.length,
        drift: { mismatches, unmapped: 0, orphaned },
      };
    }

    console.log(
      `${tag} All ${withExamPart.length} mappings already present and consistent for curriculum ${curriculumId}`
    );
    return {
      status: "already_present",
      existing: existingSet.size,
      total_lfs: lfs.length,
    };
  }

  // ── 4) Compute weights and insert missing mappings ──
  const allMappable = withExamPart; // weights computed over ALL mappable LFs
  const weights = computeDefaultWeights(allMappable);

  const inserts = toCreate.map((lf) => ({
    curriculum_id: curriculumId,
    learning_field_id: lf.id,
    exam_part: lf.exam_part,
    exam_weight: weights.get(lf.id) || 0,
    notes: `Auto-derived from learning_fields.exam_part (${lf.code})`,
  }));

  const { error: insertErr } = await sb
    .from("exam_part_mappings")
    .insert(inserts);

  if (insertErr) {
    // Unique constraint → race condition, re-read
    if (insertErr.code === "23505") {
      console.warn(`${tag} Race condition on insert, treating as already_present`);
      return {
        status: "already_present",
        existing: existingSet.size + toCreate.length,
        total_lfs: lfs.length,
      };
    }
    throw new Error(`${tag} Insert failed: ${insertErr.message}`);
  }

  console.log(
    `${tag} Created ${toCreate.length} mappings for curriculum ${curriculumId} ` +
    `(skipped ${existingSet.size} existing, ${withoutExamPart.length} without exam_part)`
  );

  return {
    status: "created",
    created: toCreate.length,
    skipped: existingSet.size,
    total_lfs: lfs.length,
  };
}

/**
 * Drift guard: validates that exam_part_mappings are consistent with
 * learning_fields.exam_part. Returns mismatches for observability.
 */
export async function checkExamPartMappingDrift(
  sb: SB,
  curriculumId: string,
): Promise<{
  ok: boolean;
  mismatches: Array<{ lf_id: string; lf_exam_part: string; mapping_exam_part: string }>;
  unmapped: Array<{ lf_id: string; code: string }>;
  orphaned: Array<{ mapping_id: string; lf_id: string }>;
}> {
  const { data: lfs } = await sb
    .from("learning_fields")
    .select("id, code, exam_part")
    .eq("curriculum_id", curriculumId);

  const { data: mappings } = await sb
    .from("exam_part_mappings")
    .select("id, learning_field_id, exam_part")
    .eq("curriculum_id", curriculumId);

  const lfMap = new Map((lfs || []).map((lf: any) => [lf.id, lf]));
  const mappingByLf = new Map((mappings || []).map((m: any) => [m.learning_field_id, m]));

  const mismatches: Array<{ lf_id: string; lf_exam_part: string; mapping_exam_part: string }> = [];
  const unmapped: Array<{ lf_id: string; code: string }> = [];
  const orphaned: Array<{ mapping_id: string; lf_id: string }> = [];

  // Check each LF with exam_part has a matching mapping
  for (const lf of (lfs || [])) {
    const normalized = normalizeExamPart(lf.exam_part);
    if (!normalized) continue;

    const mapping = mappingByLf.get(lf.id);
    if (!mapping) {
      unmapped.push({ lf_id: lf.id, code: lf.code });
    } else if (mapping.exam_part !== normalized) {
      mismatches.push({
        lf_id: lf.id,
        lf_exam_part: normalized,
        mapping_exam_part: mapping.exam_part,
      });
    }
  }

  // Check for orphaned mappings (mapping exists but LF doesn't)
  for (const m of (mappings || [])) {
    if (!lfMap.has(m.learning_field_id)) {
      orphaned.push({ mapping_id: m.id, lf_id: m.learning_field_id });
    }
  }

  return {
    ok: mismatches.length === 0 && unmapped.length === 0 && orphaned.length === 0,
    mismatches,
    unmapped,
    orphaned,
  };
}
