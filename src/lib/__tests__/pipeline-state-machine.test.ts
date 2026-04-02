/**
 * Pipeline State Machine Sandbox Test
 * 
 * Validates step-transition logic end-to-end by simulating
 * the exact same functions used by the pipeline-runner.
 * Tests: pickNextAction, buildStepOrder, deriveStepProgress, sequence guards.
 */
import { describe, it, expect } from "vitest";
import {
  FULL_STEP_ORDER,
  PIPELINE_STEP_LABELS,
  PIPELINE_STEP_SHORT_LABELS,
  PIPELINE_STEP_EMOJI,
  isPipelineStepKey,
  deriveStepProgress,
  type PipelineStepKey,
} from "../pipeline-steps";

// ─── Re-implement pickNextAction & buildStepOrder (mirrors edge function logic) ───

type StepRow = {
  step_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  meta?: Record<string, unknown> | null;
  job_id?: string | null;
  started_at?: string | null;
};

type StepAction =
  | { action: "enqueue"; stepKey: string }
  | { action: "poll"; stepKey: string; jobId: string }
  | { action: "exhausted"; stepKey: string }
  | { action: "wait"; stepKey: string }
  | null;

function buildStepOrder(steps: { step_key: string }[]): PipelineStepKey[] {
  const existing = new Set(steps.map(s => s.step_key));
  return FULL_STEP_ORDER.filter(k => existing.has(k));
}

function pickNextAction(steps: StepRow[], stepOrder: PipelineStepKey[]): StepAction {
  const byKey = new Map<string, StepRow>();
  for (const s of steps) byKey.set(s.step_key, s);

  for (const k of stepOrder) {
    const s = byKey.get(k);
    if (!s) continue;
    if (s.status === "done" || s.status === "skipped") continue;
    if (s.status === "blocked") continue;

    // Strict sequencing: backoff BLOCKS later steps
    const nra = s.meta?.next_run_at;
    if (typeof nra === "string") {
      const nraMs = Date.parse(nra);
      if (!Number.isNaN(nraMs) && nraMs > Date.now()) {
        return { action: "wait", stepKey: k };
      }
    }

    if ((s.status === "enqueued" || s.status === "running") && s.job_id) {
      return { action: "poll", stepKey: k, jobId: s.job_id };
    }
    if (s.status === "running" && !s.job_id) return { action: "enqueue", stepKey: k };
    if (s.status === "enqueued" && !s.job_id) return { action: "enqueue", stepKey: k };

    const retryable = s.status === "queued" || s.status === "failed" || s.status === "timeout";
    if (retryable && s.attempts < s.max_attempts) return { action: "enqueue", stepKey: k };
    if (retryable && s.attempts >= s.max_attempts) return { action: "exhausted", stepKey: k };
  }
  return null;
}

// ─── Helpers ───

function makeStep(key: string, status: string, overrides?: Partial<StepRow>): StepRow {
  return { step_key: key, status, attempts: 0, max_attempts: 5, ...overrides };
}

function makeFullPipeline(statusOverrides?: Record<string, string>): StepRow[] {
  return FULL_STEP_ORDER.map(k => makeStep(k, statusOverrides?.[k] ?? "queued"));
}

// ════════════════════════════════════════════════════════════════
// TEST SUITE
// ════════════════════════════════════════════════════════════════

describe("Pipeline SSOT Registry", () => {
  it("FULL_STEP_ORDER has exactly 23 steps", () => {
    expect(FULL_STEP_ORDER).toHaveLength(23);
  });

  it("every step has labels, short labels, and emoji", () => {
    for (const k of FULL_STEP_ORDER) {
      expect(PIPELINE_STEP_LABELS[k]).toBeTruthy();
      expect(PIPELINE_STEP_SHORT_LABELS[k]).toBeTruthy();
      expect(PIPELINE_STEP_EMOJI[k]).toBeTruthy();
    }
  });

  it("isPipelineStepKey validates correctly", () => {
    expect(isPipelineStepKey("scaffold_learning_course")).toBe(true);
    expect(isPipelineStepKey("auto_publish")).toBe(true);
    expect(isPipelineStepKey("nonexistent_step")).toBe(false);
  });

  it("no duplicate step keys", () => {
    const unique = new Set(FULL_STEP_ORDER);
    expect(unique.size).toBe(FULL_STEP_ORDER.length);
  });
});

describe("buildStepOrder", () => {
  it("filters to only existing steps, preserves SSOT order", () => {
    const steps = [
      makeStep("generate_handbook", "queued"),
      makeStep("scaffold_learning_course", "done"),
      makeStep("auto_publish", "queued"),
    ];
    const order = buildStepOrder(steps);
    expect(order).toEqual(["scaffold_learning_course", "generate_handbook", "auto_publish"]);
  });

  it("returns empty for no matching steps", () => {
    expect(buildStepOrder([makeStep("unknown_step", "queued")])).toEqual([]);
  });
});

describe("pickNextAction — Sequential Step Handoff", () => {
  it("picks first queued step in order", () => {
    const steps = makeFullPipeline();
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    expect(action).toEqual({ action: "enqueue", stepKey: "scaffold_learning_course" });
  });

  it("skips done steps, picks next queued", () => {
    const steps = makeFullPipeline({
      scaffold_learning_course: "done",
      generate_glossary: "done",
    });
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    expect(action).toEqual({ action: "enqueue", stepKey: "generate_learning_content" });
  });

  it("skips skipped steps", () => {
    const steps = makeFullPipeline({
      scaffold_learning_course: "done",
      generate_glossary: "skipped",
    });
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    expect(action).toEqual({ action: "enqueue", stepKey: "generate_learning_content" });
  });

  it("polls running step with job_id", () => {
    const steps = makeFullPipeline({ scaffold_learning_course: "done" });
    steps.find(s => s.step_key === "generate_glossary")!.status = "running";
    steps.find(s => s.step_key === "generate_glossary")!.job_id = "job-123";
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    expect(action).toEqual({ action: "poll", stepKey: "generate_glossary", jobId: "job-123" });
  });

  it("re-enqueues orphaned running step (no job_id)", () => {
    const steps = makeFullPipeline({ scaffold_learning_course: "done" });
    steps.find(s => s.step_key === "generate_glossary")!.status = "running";
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    expect(action).toEqual({ action: "enqueue", stepKey: "generate_glossary" });
  });

  it("returns exhausted when attempts >= max", () => {
    const steps = makeFullPipeline({ scaffold_learning_course: "done" });
    const glossary = steps.find(s => s.step_key === "generate_glossary")!;
    glossary.status = "failed";
    glossary.attempts = 5;
    glossary.max_attempts = 5;
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    expect(action).toEqual({ action: "exhausted", stepKey: "generate_glossary" });
  });

  it("returns null when all steps are done", () => {
    const steps = FULL_STEP_ORDER.map(k => makeStep(k, "done"));
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    expect(action).toBeNull();
  });

  it("BLOCKS on an earlier non-done step — never skips ahead", () => {
    // scaffold is queued, but generate_learning_content is also queued
    // Runner MUST pick scaffold first, never jump to a later step
    const steps = makeFullPipeline();
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    expect(action!.stepKey).toBe("scaffold_learning_course");
    expect(action!.stepKey).not.toBe("generate_learning_content");
  });

  it("does NOT advance past a backed-off earlier step (strict sequencing)", () => {
    const futureDate = new Date(Date.now() + 3600_000).toISOString();
    const steps = makeFullPipeline({ scaffold_learning_course: "done" });
    steps.find(s => s.step_key === "generate_glossary")!.meta = { next_run_at: futureDate };
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    // Glossary is in backoff → BLOCKS all later steps, returns "wait"
    expect(action).toEqual({ action: "wait", stepKey: "generate_glossary" });
  });

  it("skips blocked steps", () => {
    const steps = makeFullPipeline({ scaffold_learning_course: "done" });
    steps.find(s => s.step_key === "generate_glossary")!.status = "blocked";
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    expect(action?.stepKey).toBe("generate_learning_content");
  });
});

describe("pickNextAction — Full Pipeline Walk-Through", () => {
  it("simulates complete pipeline progression", () => {
    const steps = makeFullPipeline();
    const order = buildStepOrder(steps);
    const visited: string[] = [];

    // Simulate: pick action, mark done, repeat
    for (let i = 0; i < 30; i++) { // safety limit
      const action = pickNextAction(steps, order);
      if (!action) break;
      if (action.action !== "enqueue") break;
      
      // Mark step done
      const step = steps.find(s => s.step_key === action.stepKey)!;
      step.status = "done";
      step.started_at = new Date().toISOString();
      visited.push(action.stepKey);
    }

    // Must visit all steps in exact SSOT order
    expect(visited).toEqual(FULL_STEP_ORDER);
    expect(visited).toHaveLength(FULL_STEP_ORDER.length);
    
    // Final state: all done, no next action
    expect(pickNextAction(steps, order)).toBeNull();
  });

  it("simulates pipeline with skipped steps (partial track)", () => {
    // Only 5 steps exist (like a minimal track)
    const activeKeys: PipelineStepKey[] = [
      "scaffold_learning_course",
      "generate_learning_content",
      "generate_exam_pool",
      "run_integrity_check",
      "auto_publish",
    ];
    const steps = activeKeys.map(k => makeStep(k, "queued"));
    const order = buildStepOrder(steps);

    expect(order).toEqual(activeKeys); // Order preserved

    const visited: string[] = [];
    for (let i = 0; i < 10; i++) {
      const action = pickNextAction(steps, order);
      if (!action) break;
      steps.find(s => s.step_key === action.stepKey)!.status = "done";
      visited.push(action.stepKey);
    }
    expect(visited).toEqual(activeKeys);
  });
});

describe("deriveStepProgress", () => {
  it("returns 0% for all-queued", () => {
    const statuses: Record<string, string> = {};
    FULL_STEP_ORDER.forEach(k => (statuses[k] = "queued"));
    const result = deriveStepProgress(statuses);
    expect(result.progress).toBe(0);
    expect(result.doneCount).toBe(0);
    expect(result.total).toBe(20);
  });

  it("returns 100% for all-done", () => {
    const statuses: Record<string, string> = {};
    FULL_STEP_ORDER.forEach(k => (statuses[k] = "done"));
    const result = deriveStepProgress(statuses);
    expect(result.progress).toBe(100);
    expect(result.currentLabel).toBe("Fertig");
  });

  it("counts skipped as done for progress", () => {
    const statuses: Record<string, string> = {};
    FULL_STEP_ORDER.forEach(k => (statuses[k] = "skipped"));
    const result = deriveStepProgress(statuses);
    expect(result.progress).toBe(100);
  });

  it("identifies active step correctly", () => {
    const statuses: Record<string, string> = {};
    FULL_STEP_ORDER.forEach(k => (statuses[k] = "queued"));
    statuses.scaffold_learning_course = "done";
    statuses.generate_glossary = "running";
    const result = deriveStepProgress(statuses);
    expect(result.isActive).toBe(true);
    expect(result.activeStepKey).toBe("generate_glossary");
    expect(result.currentLabel).toBe("Glossar");
    expect(result.progress).toBe(5); // 1/20 = 5%
  });

  it("handles null/undefined input", () => {
    const result = deriveStepProgress(null);
    expect(result.progress).toBe(0);
    expect(result.currentLabel).toBe("—");
  });

  it("handles mixed statuses with correct progress math", () => {
    const statuses: Record<string, string> = {};
    FULL_STEP_ORDER.forEach(k => (statuses[k] = "queued"));
    // Mark first 10 as done
    FULL_STEP_ORDER.slice(0, 10).forEach(k => (statuses[k] = "done"));
    const result = deriveStepProgress(statuses);
    expect(result.progress).toBe(50);
    expect(result.doneCount).toBe(10);
  });
});

describe("Sequence Integrity — Critical Invariants", () => {
  it("INVARIANT: later step cannot be done while earlier step is queued", () => {
    // This simulates the sequence integrity guard in pipeline-process.ts
    const steps = makeFullPipeline();
    // Simulate corrupted state: step 5 done but step 3 still queued
    steps.find(s => s.step_key === "auto_seed_exam_blueprints")!.status = "done"; // step 5
    // step 3 (generate_learning_content) is still queued

    const order = buildStepOrder(steps);
    
    // The sequence guard in pipeline-process.ts would detect this and reset step 5
    // Here we verify pickNextAction behaves correctly even without the guard:
    const action = pickNextAction(steps, order);
    // It should pick the FIRST non-done step, which is scaffold_learning_course
    expect(action?.stepKey).toBe("scaffold_learning_course");
    // It should NOT jump to step 6 just because step 5 is done
    expect(action?.stepKey).not.toBe("validate_blueprints");
  });

  it("INVARIANT: validation step cannot run before its generator", () => {
    const VALIDATION_PAIRS: [string, string][] = [
      ["validate_learning_content", "generate_learning_content"],
      ["validate_blueprints", "auto_seed_exam_blueprints"],
      ["validate_exam_pool", "generate_exam_pool"],
      ["validate_tutor_index", "build_ai_tutor_index"],
      ["validate_oral_exam", "generate_oral_exam"],
      ["validate_lesson_minichecks", "generate_lesson_minichecks"],
      ["validate_handbook", "generate_handbook"],
    ];

    for (const [validator, generator] of VALIDATION_PAIRS) {
      const validatorIdx = FULL_STEP_ORDER.indexOf(validator as PipelineStepKey);
      const generatorIdx = FULL_STEP_ORDER.indexOf(generator as PipelineStepKey);
      
      expect(generatorIdx).toBeLessThan(validatorIdx);
      expect(generatorIdx).toBeGreaterThanOrEqual(0);
      expect(validatorIdx).toBeGreaterThanOrEqual(0);
    }
  });

  it("INVARIANT: elite_harden comes after all generate+validate pairs", () => {
    const eliteIdx = FULL_STEP_ORDER.indexOf("elite_harden");
    const contentSteps = [
      "generate_learning_content", "validate_learning_content",
      "generate_exam_pool", "validate_exam_pool",
      "generate_oral_exam", "validate_oral_exam",
      "generate_lesson_minichecks", "validate_lesson_minichecks",
      "generate_handbook", "validate_handbook",
    ];
    for (const step of contentSteps) {
      expect(FULL_STEP_ORDER.indexOf(step as PipelineStepKey)).toBeLessThan(eliteIdx);
    }
  });

  it("INVARIANT: auto_publish is always last", () => {
    expect(FULL_STEP_ORDER[FULL_STEP_ORDER.length - 1]).toBe("auto_publish");
  });

  it("INVARIANT: quality_council comes right before auto_publish", () => {
    const qcIdx = FULL_STEP_ORDER.indexOf("quality_council");
    const apIdx = FULL_STEP_ORDER.indexOf("auto_publish");
    expect(apIdx - qcIdx).toBe(1);
  });
});

describe("Edge Cases & Regression Guards", () => {
  it("CRITICAL: future next_run_at on an earlier step blocks all later steps", () => {
    const futureDate = new Date(Date.now() + 3600_000).toISOString();
    const steps = [
      makeStep("scaffold_learning_course", "done"),
      makeStep("generate_glossary", "queued", {
        meta: { next_run_at: futureDate },
      }),
      makeStep("generate_learning_content", "queued"),
      makeStep("validate_learning_content", "queued"),
    ];
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    // Must NOT advance to generate_learning_content — glossary blocks
    expect(action).toEqual({ action: "wait", stepKey: "generate_glossary" });
  });

  it("backed-off step with past next_run_at is actionable", () => {
    const steps = [
      makeStep("scaffold_learning_course", "done"),
      makeStep("generate_glossary", "queued", {
        meta: { next_run_at: new Date(Date.now() - 1000).toISOString() },
      }),
    ];
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    expect(action?.stepKey).toBe("generate_glossary");
  });

  it("failed step with remaining attempts is retried", () => {
    const steps = [
      makeStep("scaffold_learning_course", "done"),
      makeStep("generate_glossary", "failed", { attempts: 2, max_attempts: 5 }),
    ];
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    expect(action).toEqual({ action: "enqueue", stepKey: "generate_glossary" });
  });

  it("timeout step without job_id is re-enqueued", () => {
    const steps = [
      makeStep("scaffold_learning_course", "done"),
      makeStep("generate_glossary", "timeout", { attempts: 1, max_attempts: 5 }),
    ];
    const order = buildStepOrder(steps);
    const action = pickNextAction(steps, order);
    expect(action).toEqual({ action: "enqueue", stepKey: "generate_glossary" });
  });

  it("CRITICAL: pickNextAction never skips ahead past a non-terminal step", () => {
    // Even if multiple steps are queued, it MUST return the first one
    for (let i = 0; i < FULL_STEP_ORDER.length; i++) {
      const steps = FULL_STEP_ORDER.map((k, idx) => 
        makeStep(k, idx < i ? "done" : "queued")
      );
      const order = buildStepOrder(steps);
      const action = pickNextAction(steps, order);
      if (i < FULL_STEP_ORDER.length) {
        expect(action?.stepKey).toBe(FULL_STEP_ORDER[i]);
      }
    }
  });
});
