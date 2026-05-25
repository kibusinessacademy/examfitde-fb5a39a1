/**
 * P-Completion 3 — Adaptive Exam Engine.
 *
 * Pure, deterministic derivation. Takes a Blueprint + Mastery + Weakness
 * + (optional) Recovery state and produces an AdaptiveExamPlan plus a
 * post-exam outcome computer.
 *
 * Hard constraints:
 *  - Blueprint-conform: per-competency drift gekappt (default ±0.15).
 *  - Difficulty-mix matcht Blueprint nach Auf-/Abrundung exakt.
 *  - Keine freie Fragenerzeugung — Slot-Specs nur (competency_id + difficulty + kind).
 *  - Reine Funktion: gleiche Inputs → identische Outputs (deterministisch).
 */

import type {
  AdaptiveExamOutcome,
  AdaptiveExamPlan,
  AdaptiveExamPlanInput,
  AdaptiveExamSlot,
  BlueprintWeight,
  CompetencyDelta,
  CompetencyDistribution,
  ExamDifficulty,
  MasterySnapshot,
  SlotResult,
  TutorFollowUp,
} from "./types";

const DEFAULT_MAX_DRIFT = 0.15;

/* ---------- helpers ---------- */

function normalizeWeights(ws: ReadonlyArray<BlueprintWeight>): BlueprintWeight[] {
  const sum = ws.reduce((s, w) => s + Math.max(0, w.weight), 0);
  if (sum <= 0) {
    const even = 1 / Math.max(1, ws.length);
    return ws.map((w) => ({ ...w, weight: even }));
  }
  return ws.map((w) => ({ ...w, weight: Math.max(0, w.weight) / sum }));
}

function masteryOf(id: string, mastery: ReadonlyArray<MasterySnapshot>): number {
  const m = mastery.find((x) => x.competency_id === id);
  return m ? Math.max(0, Math.min(1, m.mastery)) : 0.5;
}

/** Stable hash (FNV-1a 32-bit). */
function signature(parts: ReadonlyArray<string | number>): string {
  let h = 0x811c9dc5;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `aep_${h.toString(16).padStart(8, "0")}`;
}

/* ---------- weight adaptation ---------- */

function adaptWeights(
  blueprint: ReadonlyArray<BlueprintWeight>,
  weakIds: ReadonlyArray<string>,
  mastery: ReadonlyArray<MasterySnapshot>,
  maxDrift: number,
): { adapted: BlueprintWeight[]; deltas: Map<string, number> } {
  const base = normalizeWeights(blueprint);
  const weak = new Set(weakIds);
  if (weak.size === 0 || base.length < 2) {
    return { adapted: base, deltas: new Map(base.map((b) => [b.competency_id, 0])) };
  }

  // Boost-Faktor: Schwäche × (1 - mastery), gekappt durch maxDrift pro Kompetenz.
  const raw = base.map((b) => {
    if (!weak.has(b.competency_id)) return { id: b.competency_id, boost: 0 };
    const gap = 1 - masteryOf(b.competency_id, mastery); // 0..1
    return { id: b.competency_id, boost: Math.min(maxDrift, 0.05 + gap * 0.15) };
  });

  const totalBoost = raw.reduce((s, r) => s + r.boost, 0);
  const nonWeak = base.filter((b) => !weak.has(b.competency_id));
  const nonWeakSum = nonWeak.reduce((s, b) => s + b.weight, 0) || 1;

  const adapted: BlueprintWeight[] = base.map((b) => {
    const r = raw.find((x) => x.id === b.competency_id)!;
    if (weak.has(b.competency_id)) {
      return { ...b, weight: b.weight + r.boost };
    }
    // proportional auf non-weak verteilen
    const reduction = totalBoost * (b.weight / nonWeakSum);
    return { ...b, weight: Math.max(0, b.weight - reduction) };
  });

  const renorm = normalizeWeights(adapted);
  const deltas = new Map<string, number>();
  for (const a of renorm) {
    const b0 = base.find((x) => x.competency_id === a.competency_id)!;
    deltas.set(a.competency_id, a.weight - b0.weight);
  }
  return { adapted: renorm, deltas };
}

/* ---------- slot-count allocation (largest-residual rounding) ---------- */

function allocateSlotCounts(
  weights: ReadonlyArray<BlueprintWeight>,
  total: number,
): Map<string, number> {
  const raw = weights.map((w) => ({ id: w.competency_id, exact: w.weight * total }));
  const floors = raw.map((r) => ({ id: r.id, n: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let used = floors.reduce((s, f) => s + f.n, 0);
  let remaining = total - used;
  // deterministisch nach (rem desc, id asc) sortieren
  const order = [...floors].sort((a, b) => (b.rem - a.rem) || a.id.localeCompare(b.id));
  for (let i = 0; remaining > 0 && i < order.length; i++) {
    order[i].n += 1;
    remaining--;
  }
  return new Map(floors.map((f) => [f.id, f.n]));
}

function allocateDifficultyCounts(
  total: number,
  dist: { easy: number; medium: number; hard: number },
): { easy: number; medium: number; hard: number } {
  const sum = dist.easy + dist.medium + dist.hard || 1;
  const exact = {
    easy: (dist.easy / sum) * total,
    medium: (dist.medium / sum) * total,
    hard: (dist.hard / sum) * total,
  };
  const floors = {
    easy: Math.floor(exact.easy),
    medium: Math.floor(exact.medium),
    hard: Math.floor(exact.hard),
  };
  let used = floors.easy + floors.medium + floors.hard;
  let remaining = total - used;
  const order: ExamDifficulty[] = (["easy", "medium", "hard"] as const)
    .map((k) => ({ k, rem: exact[k] - floors[k] }))
    .sort((a, b) => (b.rem - a.rem) || a.k.localeCompare(b.k))
    .map((x) => x.k);
  const out = { ...floors };
  for (let i = 0; remaining > 0 && i < order.length; i++) {
    out[order[i]] += 1;
    remaining--;
  }
  return out;
}

/* ---------- plan ---------- */

export function buildAdaptiveExamPlan(input: AdaptiveExamPlanInput): AdaptiveExamPlan {
  const total = Math.max(1, Math.floor(input.blueprint.total_questions));
  const maxDrift = input.blueprint.max_drift ?? DEFAULT_MAX_DRIFT;
  const baseNorm = normalizeWeights(input.blueprint.weights);
  if (baseNorm.length === 0) {
    return {
      slots: [],
      competency_distribution: [],
      difficulty_distribution: { easy: 0, medium: 0, hard: 0 },
      retest_block_size: 0,
      blueprint_conformity: 1,
      signature: signature(["empty", total]),
      rationale: "Kein Blueprint vorhanden — Plan leer.",
    };
  }

  const { adapted, deltas } = adaptWeights(baseNorm, input.weakKompetenzIds, input.mastery, maxDrift);
  const slotCounts = allocateSlotCounts(adapted, total);
  const diffCounts = allocateDifficultyCounts(total, input.blueprint.difficulty_distribution);

  // Slots vorbereiten (kompetenz-blockweise, deterministisch nach key)
  const ordered = [...adapted].sort((a, b) => a.competency_key.localeCompare(b.competency_key));
  const slots: AdaptiveExamSlot[] = [];
  const weakSet = new Set(input.weakKompetenzIds);
  const recoverySet = new Set(input.recoveryCompetencyIds ?? []);

  // Difficulty-Pool als verbleibende Counts
  const pool = { ...diffCounts };

  /** Pick difficulty deterministically for a slot based on competency state. */
  function pickDifficulty(competencyId: string): ExamDifficulty {
    const m = masteryOf(competencyId, input.mastery);
    const isWeak = weakSet.has(competencyId);
    // Präferenz-Reihenfolge
    const pref: ExamDifficulty[] = isWeak
      ? ["easy", "medium", "hard"]
      : m >= 0.75
      ? ["hard", "medium", "easy"]
      : ["medium", "hard", "easy"];
    for (const d of pref) {
      if (pool[d] > 0) {
        pool[d] -= 1;
        return d;
      }
    }
    // Fallback (sollte nicht passieren)
    pool.medium = Math.max(0, pool.medium - 1);
    return "medium";
  }

  for (const w of ordered) {
    const count = slotCounts.get(w.competency_id) ?? 0;
    for (let i = 0; i < count; i++) {
      const isWeak = weakSet.has(w.competency_id);
      const kind: AdaptiveExamSlot["kind"] = isWeak ? "weakness_focus" : "blueprint_core";
      const difficulty = pickDifficulty(w.competency_id);
      slots.push({
        position: 0, // wird unten gesetzt
        competency_id: w.competency_id,
        competency_key: w.competency_key,
        difficulty,
        kind,
        rationale: isWeak
          ? `Gewicht erhöht (Δ ${(deltas.get(w.competency_id) ?? 0).toFixed(2)}) — schwache Kompetenz.`
          : "Blueprint-konformer Kernslot.",
      });
    }
  }

  // Stabilitäts-Anker am Anfang falls Signale niedrig
  const stabilityLow = (input.signals?.structureStability ?? 1) < 0.5;
  if (stabilityLow && slots.length > 0) {
    // ersten Slot in stability_anchor + easy konvertieren (falls möglich)
    const first = slots[0];
    slots[0] = {
      ...first,
      kind: "stability_anchor",
      difficulty: "easy",
      rationale: "Ruhiger Einstieg — Struktur-Stabilität niedrig.",
    };
  }

  // Re-Test-Block am Ende: bis zu 3 Slots an recovery_competencies binden
  const retestTargets = [...recoverySet]
    .filter((id) => baseNorm.some((b) => b.competency_id === id))
    .slice(0, Math.min(3, Math.floor(total / 4)));
  if (retestTargets.length > 0) {
    const startAt = slots.length - retestTargets.length;
    for (let i = 0; i < retestTargets.length; i++) {
      const idx = startAt + i;
      if (idx < 0 || idx >= slots.length) break;
      const target = baseNorm.find((b) => b.competency_id === retestTargets[i])!;
      slots[idx] = {
        ...slots[idx],
        competency_id: target.competency_id,
        competency_key: target.competency_key,
        kind: "retest",
        rationale: "Re-Test nach Recovery — gleiche Kompetenz, mittlere Schwierigkeit.",
        difficulty: slots[idx].difficulty === "hard" ? "medium" : slots[idx].difficulty,
      };
    }
  }

  // Positionen vergeben
  for (let i = 0; i < slots.length; i++) slots[i] = { ...slots[i], position: i + 1 };

  // Distribution + Konformität
  const dist: CompetencyDistribution[] = ordered.map((w) => ({
    competency_id: w.competency_id,
    competency_key: w.competency_key,
    blueprint_weight: baseNorm.find((b) => b.competency_id === w.competency_id)?.weight ?? 0,
    adapted_weight: w.weight,
    delta: deltas.get(w.competency_id) ?? 0,
    slot_count: slotCounts.get(w.competency_id) ?? 0,
  }));
  const totalDrift = dist.reduce((s, d) => s + Math.abs(d.delta), 0);
  const conformity = Math.max(0, Math.min(1, 1 - totalDrift / 2));

  const sig = signature([
    "v1",
    total,
    diffCounts.easy, diffCounts.medium, diffCounts.hard,
    ...ordered.map((w) => `${w.competency_id}:${slotCounts.get(w.competency_id) ?? 0}`),
    ...retestTargets,
    stabilityLow ? "anchor" : "noanchor",
  ]);

  const weakInPlan = dist.filter((d) => weakSet.has(d.competency_id)).length;
  const rationale =
    weakInPlan === 0 && retestTargets.length === 0
      ? "Blueprint unverändert — keine Schwächen erkannt."
      : `${weakInPlan} Schwächen umverteilt (max Drift ±${maxDrift}), ${retestTargets.length} Re-Test-Slots, Konformität ${(conformity * 100).toFixed(0)}%.`;

  return {
    slots,
    competency_distribution: dist,
    difficulty_distribution: diffCounts,
    retest_block_size: retestTargets.length,
    blueprint_conformity: Number(conformity.toFixed(3)),
    signature: sig,
    rationale,
  };
}

/* ---------- outcome ---------- */

export function computeAdaptiveExamOutcome(
  plan: AdaptiveExamPlan,
  results: ReadonlyArray<SlotResult>,
): AdaptiveExamOutcome {
  const total = plan.slots.length;
  const byPos = new Map(results.map((r) => [r.position, r]));
  const correct = plan.slots.reduce((s, slot) => s + (byPos.get(slot.position)?.is_correct ? 1 : 0), 0);
  const score = total > 0 ? Math.round((correct / total) * 100) : 0;

  // Per-Kompetenz aggregieren
  const buckets = new Map<string, CompetencyDelta>();
  for (const slot of plan.slots) {
    const r = byPos.get(slot.position);
    const bucket = buckets.get(slot.competency_id) ?? {
      competency_id: slot.competency_id,
      competency_key: slot.competency_key,
      attempted: 0,
      correct: 0,
      mastery_delta: 0,
    };
    bucket.attempted += r ? 1 : 0;
    bucket.correct += r?.is_correct ? 1 : 0;
    buckets.set(slot.competency_id, bucket);
  }
  for (const b of buckets.values()) {
    if (b.attempted === 0) { b.mastery_delta = 0; continue; }
    const acc = b.correct / b.attempted;
    // Sigmoid-frei, linear gewichtet: ±0.18 max pro Session/Kompetenz
    b.mastery_delta = Number((((acc - 0.5) * 0.36)).toFixed(3));
  }
  const perCompetency = [...buckets.values()].sort((a, b) =>
    a.mastery_delta - b.mastery_delta || a.competency_key.localeCompare(b.competency_key),
  );

  // Readiness-Delta: gewichteter Score + Penalty für schwache Bereiche
  const baseDelta = (score - 50) / 5; // -10..+10
  const weakPenalty = perCompetency
    .filter((c) => c.mastery_delta < -0.05)
    .reduce((s, c) => s + c.mastery_delta * 10, 0); // additiv negativ
  const readinessDelta = Math.max(-20, Math.min(20, Math.round(baseDelta + weakPenalty)));

  // Tutor-Follow-ups deterministisch: schwächste Kompetenz mit attempted>0 zuerst
  const followups: TutorFollowUp[] = perCompetency
    .filter((c) => c.attempted > 0 && c.correct < c.attempted)
    .slice(0, 4)
    .map((c) => {
      const acc = c.correct / c.attempted;
      const path: TutorFollowUp["path_type"] =
        acc <= 0.25 ? "explain_again" :
        acc <= 0.5  ? "practice_drill" :
        acc <= 0.75 ? "exam_trap_training" :
        "confidence_recovery";
      const rationale =
        path === "explain_again"      ? "Stark unter Schwelle — Grundlagen neu aufbauen." :
        path === "practice_drill"     ? "Wiederholungen mit ähnlichem Aufgabentyp."        :
        path === "exam_trap_training" ? "Typische Prüfungsfalle gezielt trainieren."        :
                                        "Confidence stabilisieren — kleine Erfolge.";
      return {
        competency_id: c.competency_id,
        competency_key: c.competency_key,
        path_type: path,
        rationale,
      };
    });

  return {
    total,
    correct,
    score_percentage: score,
    readiness_delta: readinessDelta,
    per_competency: perCompetency,
    tutor_followups: followups,
    plan_signature: plan.signature,
  };
}
