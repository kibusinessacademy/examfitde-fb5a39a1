/**
 * Cut-9-Slot im Lesson-Player.
 *
 * Harte learner-safe Regeln (siehe oral-visual-policy.ts):
 *  - KEINE eigenen DB-/HTTP-Reads im Client. Die Projection muss vom
 *    Caller bereits aus `lesson.content` extrahiert (also als Teil des
 *    Lesson-Records geladen) übergeben werden — kein zusätzlicher
 *    `supabase.from(...).select(...)`-Aufruf hier.
 *  - KEIN Anzeigen vor Antwortabgabe — Gate `answerSubmitted` ist
 *    Pflicht; ist es false, rendert die Komponente nichts.
 *  - KEINE Aussage zu Note / Prüfungsreife / bestanden — Sanitizer-Pass
 *    über `FORBIDDEN_LEARNER_TOKENS` filtert Hinweise zusätzlich raus.
 *  - Rendert ausschließlich die learner-safe `OralVisualLearnerProjection`,
 *    keine Admin-Felder (severity, blocker, source_refs).
 */
import { useMemo } from "react";
import type { Json } from "@/integrations/supabase/types";
import { OralVisualFeedback } from "@/components/learning/OralVisualFeedback";
import type {
  OralVisualLearnerHint,
  OralVisualLearnerProjection,
} from "@/lib/visual-learning-os/oral-visual-feedback";

const FORBIDDEN_TOKENS_RE =
  /\b(note|noten|bestanden|nicht\s+bestanden|pr(?:ü|ue)fungsreife|grade|score[-\s]?gewicht)\b/i;

const ALLOWED_HINT_KINDS: ReadonlyArray<OralVisualLearnerHint["kind"]> = [
  "key_node_missing",
  "relation_missing",
  "misconception_risk",
  "structure_aligned",
  "answer_too_unstructured",
  "needs_followup_question",
  "good_practice_reference",
];

function isLearnerSafe(text: string): boolean {
  return !FORBIDDEN_TOKENS_RE.test(String(text ?? ""));
}

/**
 * Extrahiert eine learner-safe Projection aus einer Lesson-Content-JSON.
 * Akzeptiert ausschließlich strikt geformte Objekte unter
 * `oral_visual_projection` (snake_case, SSOT-Format) und filtert defensiv.
 *
 * Gibt `null` zurück, wenn nichts Renderbares oder das Format ungültig ist.
 */
export function extractOralVisualProjection(
  content: Json | null | undefined,
): OralVisualLearnerProjection | null {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return null;
  }
  const raw = (content as Record<string, unknown>).oral_visual_projection;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  if (r.learner_visible !== true) return null;

  const hintsRaw = Array.isArray(r.hints) ? r.hints : [];
  const hints: OralVisualLearnerHint[] = [];
  for (const h of hintsRaw) {
    if (!h || typeof h !== "object") continue;
    const obj = h as Record<string, unknown>;
    const kind = obj.kind as OralVisualLearnerHint["kind"];
    const message = typeof obj.message === "string" ? obj.message : "";
    const textAlt = typeof obj.text_alt === "string" ? obj.text_alt : "";
    if (!ALLOWED_HINT_KINDS.includes(kind)) continue;
    if (!message || !isLearnerSafe(message)) continue;
    if (!textAlt || !isLearnerSafe(textAlt)) continue;
    hints.push({ kind, message, text_alt: textAlt });
    if (hints.length >= 5) break; // mirror FROZEN_VLO_ORAL_VISUAL_POLICY.max_learner_hints
  }

  const curriculum_id = typeof r.curriculum_id === "string" ? r.curriculum_id : "";
  const competence_id = typeof r.competence_id === "string" ? r.competence_id : "";
  const oral_question_id =
    typeof r.oral_question_id === "string" ? r.oral_question_id : "";
  const disclaimer =
    typeof r.disclaimer === "string" && isLearnerSafe(r.disclaimer)
      ? r.disclaimer
      : "Strukturhinweise zu deiner Antwort — keine mündliche Bewertung.";

  return {
    curriculum_id,
    competence_id,
    oral_question_id,
    hints,
    learner_visible: true,
    empty: hints.length === 0,
    disclaimer,
  };
}

interface Props {
  /** Bereits geladene Lesson-Content-JSON (kein eigener Fetch). */
  content: Json | null | undefined;
  /**
   * MUSS true sein. Spiegelt die Hardregel: kein Strukturfeedback,
   * bevor die learner-Antwort abgegeben/abgeschlossen wurde.
   */
  answerSubmitted: boolean;
  className?: string;
}

export function LessonOralVisualSlot({
  content,
  answerSubmitted,
  className,
}: Props) {
  const projection = useMemo(
    () => extractOralVisualProjection(content),
    [content],
  );

  // Hard gate: pre-submission → render nothing.
  if (!answerSubmitted) return null;
  if (!projection || projection.empty) return null;

  return (
    <section
      data-testid="lesson-oral-visual-slot"
      data-cut="9"
      aria-label="Strukturfeedback zu deiner Antwort"
      className={className}
    >
      <OralVisualFeedback projection={projection} />
      <p className="mt-2 text-xs text-muted-foreground">
        {projection.disclaimer}
      </p>
    </section>
  );
}

export default LessonOralVisualSlot;
