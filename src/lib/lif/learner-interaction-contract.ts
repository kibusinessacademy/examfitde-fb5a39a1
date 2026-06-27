/**
 * LIF.OS.1 — Learner Interaction Framework Contract (SSOT)
 *
 * Pure SSOT for any surface that collects learner input on the platform
 * (AI Tutor, MiniChecks, Oral Exam, Reflection, Notes, Feedback, Ratings,
 * Lernjournal, …).
 *
 * Rules:
 *  - No React / no DOM here. Pure types + small helpers only.
 *  - Frontend renderers MUST derive their input affordances from a single
 *    `LearnerInteractionSpec`. Ad-hoc <textarea> / <input> usage in
 *    interactive learner surfaces is deprecated.
 *  - Validation rules live here, not in renderers.
 */

export type ExpectedInputKind =
  | 'text'
  | 'voice'
  | 'upload'
  | 'singleChoice'
  | 'multipleChoice'
  | 'ordering'
  | 'rating'
  | 'yesno';

export type AnswerActionKind =
  | 'submit'        // primary "Antwort prüfen"
  | 'save_draft'    // Zwischenspeichern
  | 'retry'         // erneut versuchen
  | 'show_solution' // Musterlösung
  | 'skip';         // optional überspringen

export interface ChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
}

export interface LearnerInteractionSpec {
  /** Stable id of the interaction call-site, e.g. "lesson_tutor.quiz_me". */
  readonly surfaceId: string;
  /** Which input modality to render. */
  readonly expectedInput: ExpectedInputKind;
  /** Human-visible prompt for the answer surface (German default). */
  readonly answerLabel?: string;
  /** Placeholder for the text input. */
  readonly placeholder?: string;
  /** Allow voice input alongside text (only meaningful when expectedInput === 'text' or 'voice'). */
  readonly allowVoice?: boolean;
  /** Allow file upload alongside the primary input. */
  readonly allowUpload?: boolean;
  /** Min / max character constraints (text + voice). */
  readonly minChars?: number;
  readonly maxChars?: number;
  /** Choice options for singleChoice / multipleChoice / ordering. */
  readonly options?: ReadonlyArray<ChoiceOption>;
  /** Which submit-related actions are available. Order is rendering order. */
  readonly actions?: ReadonlyArray<AnswerActionKind>;
  /** Whether the surface is disabled (e.g. fail-closed context). */
  readonly disabled?: boolean;
  /** Optional helper / hint text shown collapsed by default. */
  readonly hint?: string;
}

export interface LearnerAnswerPayloadText {
  readonly kind: 'text';
  readonly value: string;
  readonly viaVoice?: boolean;
}
export interface LearnerAnswerPayloadChoice {
  readonly kind: 'singleChoice' | 'multipleChoice' | 'ordering';
  readonly selectedIds: ReadonlyArray<string>;
}
export interface LearnerAnswerPayloadRating {
  readonly kind: 'rating';
  readonly value: number; // 1..5 by default
}
export interface LearnerAnswerPayloadYesNo {
  readonly kind: 'yesno';
  readonly value: boolean;
}
export interface LearnerAnswerPayloadUpload {
  readonly kind: 'upload';
  readonly files: ReadonlyArray<{ name: string; size: number; mime: string }>;
}

export type LearnerAnswerPayload =
  | LearnerAnswerPayloadText
  | LearnerAnswerPayloadChoice
  | LearnerAnswerPayloadRating
  | LearnerAnswerPayloadYesNo
  | LearnerAnswerPayloadUpload;

export interface ValidationResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/** Pure validator — exported for unit tests and renderers. */
export function validateAnswer(
  spec: LearnerInteractionSpec,
  payload: LearnerAnswerPayload | null,
): ValidationResult {
  if (spec.disabled) return { ok: false, reason: 'Eingabe aktuell deaktiviert.' };
  if (!payload) return { ok: false, reason: 'Bitte gib eine Antwort ein.' };

  switch (spec.expectedInput) {
    case 'text':
    case 'voice': {
      if (payload.kind !== 'text') return { ok: false, reason: 'Textantwort erwartet.' };
      const trimmed = payload.value.trim();
      if (!trimmed) return { ok: false, reason: 'Antwort darf nicht leer sein.' };
      if (spec.minChars && trimmed.length < spec.minChars)
        return { ok: false, reason: `Mindestens ${spec.minChars} Zeichen.` };
      if (spec.maxChars && trimmed.length > spec.maxChars)
        return { ok: false, reason: `Maximal ${spec.maxChars} Zeichen.` };
      return { ok: true };
    }
    case 'singleChoice':
    case 'multipleChoice':
    case 'ordering': {
      if (payload.kind === 'text' || payload.kind === 'rating' || payload.kind === 'yesno' || payload.kind === 'upload')
        return { ok: false, reason: 'Auswahl erwartet.' };
      if (payload.selectedIds.length === 0) return { ok: false, reason: 'Bitte mindestens eine Option wählen.' };
      if (spec.expectedInput === 'singleChoice' && payload.selectedIds.length !== 1)
        return { ok: false, reason: 'Genau eine Option wählen.' };
      return { ok: true };
    }
    case 'rating': {
      if (payload.kind !== 'rating') return { ok: false, reason: 'Bewertung erwartet.' };
      if (payload.value < 1 || payload.value > 5) return { ok: false, reason: 'Bewertung muss 1–5 sein.' };
      return { ok: true };
    }
    case 'yesno': {
      if (payload.kind !== 'yesno') return { ok: false, reason: 'Ja/Nein erwartet.' };
      return { ok: true };
    }
    case 'upload': {
      if (payload.kind !== 'upload') return { ok: false, reason: 'Datei erwartet.' };
      if (payload.files.length === 0) return { ok: false, reason: 'Bitte mindestens eine Datei wählen.' };
      return { ok: true };
    }
    default:
      return { ok: false, reason: 'Unbekannter Eingabetyp.' };
  }
}

/** Default actions when none specified. */
export const DEFAULT_ANSWER_ACTIONS: ReadonlyArray<AnswerActionKind> = ['submit'];
