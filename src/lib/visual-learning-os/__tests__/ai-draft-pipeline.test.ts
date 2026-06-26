import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ADMIN_ONLY_AI_DRAFT_CONTEXT_FIXTURE,
  ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_HEX_COLOR,
  ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_MISSING_REFS,
  ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_UNKNOWN_NODE,
  ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_VALID,
} from "../fixtures";
import { buildVisualAiDraftRequest } from "../ai-draft-request";
import { normalizeVisualAiOutput } from "../ai-output-normalizer";
import { prepareVisualArtifactDraftFromAi } from "../ai-draft-pipeline";
import { createAdminPreviewArtifact } from "../admin-preview";
import { FROZEN_AI_VISUAL_DRAFT_POLICY } from "../ai-draft-policy";
import {
  VISUAL_EDGE_KINDS,
  VISUAL_MISCONCEPTION_KINDS,
  VISUAL_NODE_ROLES,
} from "../contracts";

const validCtx = ADMIN_ONLY_AI_DRAFT_CONTEXT_FIXTURE;
const validRaw = ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_VALID;

function hasBlocker(result: { blockers: Array<{ code: string }> }, code: string) {
  return result.blockers.some((b) => b.code === code);
}

describe("VISUAL.LEARNING.OS — Cut 6 AI Draft (request + normalizer + pipeline)", () => {
  it("1. buildVisualAiDraftRequest ist deterministisch", () => {
    const a = buildVisualAiDraftRequest(validCtx);
    const b = buildVisualAiDraftRequest(validCtx);
    expect(a).toEqual(b);
  });

  it("2. Request enthält curriculum_id und competence_id", () => {
    const r = buildVisualAiDraftRequest(validCtx);
    expect(r.context.curriculum_id).toBe("fixture-curr");
    expect(r.context.competence_id).toBe("fixture-comp");
  });

  it("3. Request enthält allowed node/edge/misconception grammar", () => {
    const r = buildVisualAiDraftRequest(validCtx);
    expect(r.allowed_node_types).toEqual(VISUAL_NODE_ROLES);
    expect(r.allowed_edge_types).toEqual(VISUAL_EDGE_KINDS);
    expect(r.allowed_misconception_types).toEqual(VISUAL_MISCONCEPTION_KINDS);
  });

  it("4. Request verbietet Publishing in den Output-Anforderungen", () => {
    const r = buildVisualAiDraftRequest(validCtx);
    expect(r.output_requirements.must_not_include).toContain("publish_signals");
  });

  it("5. Request verbietet Learner-Sichtbarkeit", () => {
    const r = buildVisualAiDraftRequest(validCtx);
    expect(r.output_requirements.must_not_include).toContain("learner_visibility_signals");
  });

  it("6. Request fordert source_refs je fachlichem Element", () => {
    const r = buildVisualAiDraftRequest(validCtx);
    expect(r.output_requirements.must_include).toContain("source_refs_per_element");
  });

  it("7. normalizeVisualAiOutput ist deterministisch", () => {
    const req = buildVisualAiDraftRequest(validCtx);
    const a = normalizeVisualAiOutput(validRaw, req);
    const b = normalizeVisualAiOutput(validRaw, req);
    expect(a).toEqual(b);
  });

  it("8. Unstrukturierter AI Output blockiert", () => {
    const req = buildVisualAiDraftRequest(validCtx);
    const r = normalizeVisualAiOutput("nur freier prosa-text" as unknown, req);
    expect(hasBlocker(r, "AI_VISUAL_OUTPUT_NOT_STRUCTURED")).toBe(true);
    expect(r.normalized_draft).toBeNull();
  });

  it("9. Hex-Farben im AI Output werden blockiert oder sicher verworfen", () => {
    const req = buildVisualAiDraftRequest(validCtx);
    const r = normalizeVisualAiOutput(ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_HEX_COLOR, req);
    expect(hasBlocker(r, "AI_VISUAL_OUTPUT_CONTAINS_HEX_COLOR")).toBe(true);
  });

  it("10. Tailwind-Farben im AI Output werden blockiert oder sicher verworfen", () => {
    const req = buildVisualAiDraftRequest(validCtx);
    const r = normalizeVisualAiOutput(
      {
        nodes: [
          { id: "n1", role: "process_step", label: "Schritt A", source_ref: validCtx.source_refs[0] },
          { id: "n2", role: "process_step", label: "Schritt B", source_ref: validCtx.source_refs[0] },
        ],
        edges: [
          {
            from: "n1",
            to: "n2",
            kind: "precedes",
            label: "bg-red-500",
            source_ref: validCtx.source_refs[0],
          },
        ],
      },
      req,
    );
    expect(hasBlocker(r, "AI_VISUAL_OUTPUT_CONTAINS_TAILWIND_COLOR")).toBe(true);
  });

  it("11. Unbekannter Node Type wird verworfen oder blockiert", () => {
    const req = buildVisualAiDraftRequest(validCtx);
    const r = normalizeVisualAiOutput(ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_UNKNOWN_NODE, req);
    expect(hasBlocker(r, "AI_VISUAL_OUTPUT_UNSUPPORTED_NODE_TYPE")).toBe(true);
  });

  it("12. Unbekannter Edge Type wird verworfen oder blockiert", () => {
    const req = buildVisualAiDraftRequest(validCtx);
    const r = normalizeVisualAiOutput(
      {
        nodes: [
          { id: "n1", role: "process_step", label: "A", source_ref: validCtx.source_refs[0] },
          { id: "n2", role: "process_step", label: "B", source_ref: validCtx.source_refs[0] },
        ],
        edges: [
          { from: "n1", to: "n2", kind: "telepathy", source_ref: validCtx.source_refs[0] },
        ],
      },
      req,
    );
    expect(hasBlocker(r, "AI_VISUAL_OUTPUT_UNSUPPORTED_EDGE_TYPE")).toBe(true);
  });

  it("13. Unbekannter Misconception Type wird verworfen oder blockiert", () => {
    const req = buildVisualAiDraftRequest(validCtx);
    const r = normalizeVisualAiOutput(
      {
        nodes: [
          { id: "n1", role: "process_step", label: "A", source_ref: validCtx.source_refs[0] },
          { id: "n2", role: "process_step", label: "B", source_ref: validCtx.source_refs[0] },
        ],
        edges: [{ from: "n1", to: "n2", kind: "precedes", source_ref: validCtx.source_refs[0] }],
        misconceptions: [
          { kind: "alien_invasion", description: "Foo", source_ref: validCtx.source_refs[0] },
        ],
      },
      req,
    );
    expect(hasBlocker(r, "AI_VISUAL_OUTPUT_UNSUPPORTED_MISCONCEPTION_TYPE")).toBe(true);
  });

  it("14. Fehlende source_refs erzeugen Blocker", () => {
    const req = buildVisualAiDraftRequest(validCtx);
    const r = normalizeVisualAiOutput(ADMIN_ONLY_AI_RAW_OUTPUT_FIXTURE_MISSING_REFS, req);
    expect(hasBlocker(r, "AI_VISUAL_MISSING_SOURCE_REFS")).toBe(true);
  });

  it("15. Zu viele Nodes werden auf Policy-Limit reduziert", () => {
    const req = buildVisualAiDraftRequest(validCtx);
    const nodes = Array.from(
      { length: FROZEN_AI_VISUAL_DRAFT_POLICY.max_nodes + 5 },
      (_, i) => ({
        id: `n${String(i).padStart(3, "0")}`,
        role: "process_step",
        label: `Schritt ${i}`,
        source_ref: validCtx.source_refs[0],
      }),
    );
    const r = normalizeVisualAiOutput(
      {
        nodes,
        edges: [
          { from: "n000", to: "n001", kind: "precedes", source_ref: validCtx.source_refs[0] },
        ],
      },
      req,
    );
    expect(r.normalized_draft?.nodes.length).toBe(FROZEN_AI_VISUAL_DRAFT_POLICY.max_nodes);
    expect(r.warnings.some((w) => w.code === "AI_VISUAL_TOO_MANY_NODES")).toBe(true);
  });

  it("16. Zu viele Edges werden auf Policy-Limit reduziert", () => {
    const req = buildVisualAiDraftRequest(validCtx);
    const nodes = [
      { id: "a", role: "process_step", label: "A", source_ref: validCtx.source_refs[0] },
      { id: "b", role: "process_step", label: "B", source_ref: validCtx.source_refs[0] },
    ];
    const edges = Array.from(
      { length: FROZEN_AI_VISUAL_DRAFT_POLICY.max_edges + 4 },
      () => ({
        from: "a",
        to: "b",
        kind: "precedes",
        source_ref: validCtx.source_refs[0],
      }),
    );
    const r = normalizeVisualAiOutput({ nodes, edges }, req);
    expect(r.normalized_draft?.edges.length).toBe(FROZEN_AI_VISUAL_DRAFT_POLICY.max_edges);
    expect(r.warnings.some((w) => w.code === "AI_VISUAL_TOO_MANY_EDGES")).toBe(true);
  });

  it("17. Normalizer erzeugt nie approved/published", () => {
    const req = buildVisualAiDraftRequest(validCtx);
    const r = normalizeVisualAiOutput(
      { ...validRaw, status: "published", publish: true },
      req,
    );
    // Publish-Signal blockiert oder Output bleibt jedenfalls ohne approved/published-Artefakt.
    expect(r.artifact_draft).toBeNull();
    expect(r.publishable).toBe(false);
  });

  it("18. AI Draft Pipeline ruft kein LLM/HTTP/DB", () => {
    // Statischer Check: weder die Pipeline-Datei noch Normalizer/Request importieren
    // fetch/supabase/llm-Module.
    const files = [
      "src/lib/visual-learning-os/ai-draft-pipeline.ts",
      "src/lib/visual-learning-os/ai-output-normalizer.ts",
      "src/lib/visual-learning-os/ai-draft-request.ts",
      "src/lib/visual-learning-os/ai-draft-policy.ts",
    ];
    for (const f of files) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(src).not.toMatch(/from\s+["']@\/integrations\/supabase/);
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/\bopenai\b/i);
      expect(src).not.toMatch(/lovable-?api-?key/i);
    }
  });

  it("19+20. AI Draft Pipeline liefert learner_visible=false und publishable=false", () => {
    const r = prepareVisualArtifactDraftFromAi({ context: validCtx, raw_output: validRaw });
    expect(r.learner_visible).toBe(false);
    expect(r.publishable).toBe(false);
  });

  it("21+22. AI Draft Pipeline läuft durch Factory und Review-Gate", () => {
    const r = prepareVisualArtifactDraftFromAi({ context: validCtx, raw_output: validRaw });
    expect(r.artifact_draft).not.toBeNull();
    expect(r.review_result).not.toBeNull();
    // Factory hat Pflichtfelder gesetzt.
    expect(r.artifact_draft?.curriculum_id).toBe(validCtx.curriculum_id);
    expect(r.artifact_draft?.competence_id).toBe(validCtx.competence_id);
    expect(r.artifact_draft?.assessment_rubric).toBeTruthy();
  });

  it("23. Artifact Draft aus AI bleibt draft/needs_review (nie approved/published)", () => {
    const r = prepareVisualArtifactDraftFromAi({ context: validCtx, raw_output: validRaw });
    expect(["draft", "review"]).toContain(r.artifact_draft?.status ?? "missing");
  });

  it("24. Admin Preview kann aus AI Draft erstellt werden", () => {
    const r = prepareVisualArtifactDraftFromAi({ context: validCtx, raw_output: validRaw });
    const preview = createAdminPreviewArtifact(r.artifact_draft);
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.preview.preview_mode).toBe("admin_review_only");
      expect(preview.preview.publishable).toBe(false);
    }
  });

  it("25. PublishedVisualArtifact kann nicht direkt aus AI Output entstehen", () => {
    const r = prepareVisualArtifactDraftFromAi({
      context: validCtx,
      raw_output: { ...validRaw, status: "published" },
    });
    expect(r.publishable).toBe(false);
    if (r.artifact_draft) {
      expect(["approved", "published"]).not.toContain(r.artifact_draft.status);
    }
  });

  it("Kontext-Validierung: fehlende curriculum_id blockiert", () => {
    const req = buildVisualAiDraftRequest({ ...validCtx, curriculum_id: "" });
    const r = normalizeVisualAiOutput(validRaw, req);
    expect(hasBlocker(r, "AI_VISUAL_MISSING_CURRICULUM_ID")).toBe(true);
  });

  it("Verbotene Learner-Sichtbarkeitssignale werden geblockt", () => {
    const req = buildVisualAiDraftRequest(validCtx);
    const r = normalizeVisualAiOutput(
      { ...validRaw, learner_visible: true },
      req,
    );
    expect(hasBlocker(r, "AI_VISUAL_LEARNER_VISIBLE_FORBIDDEN")).toBe(true);
  });
});
