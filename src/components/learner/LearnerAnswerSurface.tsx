import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Send, Loader2, Save, RotateCcw, Eye, SkipForward, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  type LearnerInteractionSpec,
  type LearnerAnswerPayload,
  type AnswerActionKind,
  validateAnswer,
} from '@/lib/lif/learner-interaction-contract';

/**
 * LIF.OS.1 — LearnerAnswerSurface
 *
 * Single answer surface for the whole platform. Always provides at minimum a
 * visible input affordance, so a learner is never blocked by a missing field
 * after a prompt like "Schreib deine Antwort".
 *
 * The component is intentionally presentational + local-state only.
 * Persistence, scoring, AI grading happen in the caller via `onSubmit`.
 */

export interface LearnerAnswerSurfaceProps {
  spec: LearnerInteractionSpec;
  busy?: boolean;
  className?: string;
  onSubmit: (payload: LearnerAnswerPayload) => void | Promise<void>;
  onAction?: (action: AnswerActionKind) => void;
}

// minimal browser Speech Recognition typing — keeps us free of /// reference
type AnySpeech = {
  new (): {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start: () => void;
    stop: () => void;
    abort: () => void;
    onresult: ((e: unknown) => void) | null;
    onerror: ((e: unknown) => void) | null;
    onend: ((e: unknown) => void) | null;
  };
};
function getSpeechCtor(): AnySpeech | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: AnySpeech; webkitSpeechRecognition?: AnySpeech };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function LearnerAnswerSurface({
  spec,
  busy,
  className,
  onSubmit,
  onAction,
}: LearnerAnswerSurfaceProps) {
  const [text, setText] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [yesNo, setYesNo] = useState<boolean | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const recognitionRef = useRef<ReturnType<NonNullable<AnySpeech>['prototype']['stop']> extends void
    ? InstanceType<NonNullable<AnySpeech>> | null
    : null>(null);

  const allowVoice = (spec.expectedInput === 'text' || spec.expectedInput === 'voice') && (spec.allowVoice ?? spec.expectedInput === 'voice' ?? false);
  const isText = spec.expectedInput === 'text' || spec.expectedInput === 'voice';
  const actions = useMemo<ReadonlyArray<AnswerActionKind>>(
    () => (spec.actions && spec.actions.length > 0 ? spec.actions : ['submit']),
    [spec.actions],
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      try { (recognitionRef.current as unknown as { abort?: () => void } | null)?.abort?.(); } catch { /* noop */ }
    };
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceError(null);
    if (isRecording) {
      try { (recognitionRef.current as unknown as { stop?: () => void } | null)?.stop?.(); } catch { /* noop */ }
      setIsRecording(false);
      return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) {
      setVoiceError('Spracheingabe wird in diesem Browser nicht unterstützt. Bitte Text eingeben.');
      return;
    }
    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'de-DE';
      rec.onresult = (event: unknown) => {
        const e = event as { results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }> & { isFinal?: boolean }>; resultIndex: number };
        let finalText = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i] as unknown as { isFinal?: boolean; 0: { transcript: string } };
          if (r.isFinal && r[0]) finalText += r[0].transcript + ' ';
        }
        if (finalText) setText((prev) => (prev ? prev + ' ' : '') + finalText.trim());
      };
      rec.onerror = (event: unknown) => {
        const code = (event as { error?: string })?.error ?? 'unknown';
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          setVoiceError('Mikrofon-Zugriff blockiert. Du kannst weiter per Text antworten.');
        } else if (code === 'audio-capture') {
          setVoiceError('Kein Mikrofon gefunden. Du kannst weiter per Text antworten.');
        } else if (code === 'no-speech') {
          setVoiceError('Nichts gehört — sprich bitte etwas lauter oder antworte per Text.');
        }
        setIsRecording(false);
      };
      rec.onend = () => setIsRecording(false);
      rec.start();
      (recognitionRef.current as unknown as { stop?: () => void } | null) = rec as never;
      setIsRecording(true);
    } catch {
      setVoiceError('Spracheingabe konnte nicht gestartet werden. Bitte Text eingeben.');
      setIsRecording(false);
    }
  }, [isRecording]);

  const buildPayload = useCallback((): LearnerAnswerPayload | null => {
    switch (spec.expectedInput) {
      case 'text':
      case 'voice':
        return { kind: 'text', value: text, viaVoice: spec.expectedInput === 'voice' };
      case 'singleChoice':
      case 'multipleChoice':
      case 'ordering':
        return { kind: spec.expectedInput, selectedIds };
      case 'rating':
        return rating == null ? null : { kind: 'rating', value: rating };
      case 'yesno':
        return yesNo == null ? null : { kind: 'yesno', value: yesNo };
      case 'upload':
        return { kind: 'upload', files: files.map((f) => ({ name: f.name, size: f.size, mime: f.type })) };
      default:
        return null;
    }
  }, [files, rating, selectedIds, spec.expectedInput, text, yesNo]);

  const handleSubmit = useCallback(async () => {
    setSubmitError(null);
    const payload = buildPayload();
    const validation = validateAnswer(spec, payload);
    if (!validation.ok || !payload) {
      setSubmitError(validation.reason ?? 'Antwort unvollständig.');
      return;
    }
    await onSubmit(payload);
    // Soft-reset text only — keep choices in case caller wants to compare.
    if (spec.expectedInput === 'text' || spec.expectedInput === 'voice') setText('');
  }, [buildPayload, onSubmit, spec]);

  const handleActionClick = (action: AnswerActionKind) => {
    if (action === 'submit') {
      void handleSubmit();
      return;
    }
    onAction?.(action);
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface-raised/70 p-4 space-y-3',
        spec.disabled && 'opacity-60 pointer-events-none',
        className,
      )}
      data-testid="learner-answer-surface"
      data-surface-id={spec.surfaceId}
      data-expected-input={spec.expectedInput}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">
          {spec.answerLabel ?? '✍️ Deine Antwort'}
        </p>
        {isText && spec.maxChars && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {text.length}/{spec.maxChars}
          </span>
        )}
      </div>

      {isText && (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={spec.placeholder ?? 'Schreib deine Antwort …'}
          rows={4}
          maxLength={spec.maxChars}
          className="min-h-[96px] resize-y"
          data-testid="learner-answer-text"
        />
      )}

      {spec.expectedInput === 'singleChoice' && spec.options && (
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {spec.options.map((opt) => {
            const active = selectedIds[0] === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelectedIds([opt.id])}
                className={cn(
                  'px-3 py-2 text-sm rounded-full border transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-surface-sunken border-border hover:bg-surface-raised',
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {(spec.expectedInput === 'multipleChoice' || spec.expectedInput === 'ordering') && spec.options && (
        <div className="flex flex-wrap gap-2">
          {spec.options.map((opt) => {
            const active = selectedIds.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setSelectedIds((prev) =>
                    prev.includes(opt.id) ? prev.filter((id) => id !== opt.id) : [...prev, opt.id],
                  )
                }
                className={cn(
                  'px-3 py-2 text-sm rounded-lg border transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-surface-sunken border-border hover:bg-surface-raised',
                )}
              >
                {active && spec.expectedInput === 'ordering' && (
                  <span className="mr-1 text-xs tabular-nums">{selectedIds.indexOf(opt.id) + 1}.</span>
                )}
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {spec.expectedInput === 'rating' && (
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Bewertung">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              onClick={() => setRating(n)}
              className={cn(
                'h-9 w-9 rounded-full border text-sm font-semibold transition-colors',
                rating != null && rating >= n
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-surface-sunken border-border hover:bg-surface-raised',
              )}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {spec.expectedInput === 'yesno' && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant={yesNo === true ? 'default' : 'outline'}
            size="sm"
            onClick={() => setYesNo(true)}
          >
            Ja
          </Button>
          <Button
            type="button"
            variant={yesNo === false ? 'default' : 'outline'}
            size="sm"
            onClick={() => setYesNo(false)}
          >
            Nein
          </Button>
        </div>
      )}

      {(spec.allowUpload || spec.expectedInput === 'upload') && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <Upload className="h-3.5 w-3.5" />
          <span>{files.length > 0 ? `${files.length} Datei(en) ausgewählt` : 'Datei hinzufügen (optional)'}</span>
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {allowVoice && (
          <Button
            type="button"
            variant={isRecording ? 'destructive' : 'outline'}
            size="sm"
            onClick={toggleVoice}
            disabled={busy}
            className="gap-1.5"
            aria-pressed={isRecording}
            data-testid="learner-answer-mic"
          >
            {isRecording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            {isRecording ? 'Aufnahme stoppen' : 'Sprachantwort'}
          </Button>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          {actions.includes('save_draft') && (
            <Button type="button" variant="ghost" size="sm" onClick={() => handleActionClick('save_draft')} className="gap-1.5">
              <Save className="h-3.5 w-3.5" /> Speichern
            </Button>
          )}
          {actions.includes('retry') && (
            <Button type="button" variant="ghost" size="sm" onClick={() => handleActionClick('retry')} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Erneut
            </Button>
          )}
          {actions.includes('show_solution') && (
            <Button type="button" variant="ghost" size="sm" onClick={() => handleActionClick('show_solution')} className="gap-1.5">
              <Eye className="h-3.5 w-3.5" /> Lösung
            </Button>
          )}
          {actions.includes('skip') && (
            <Button type="button" variant="ghost" size="sm" onClick={() => handleActionClick('skip')} className="gap-1.5">
              <SkipForward className="h-3.5 w-3.5" /> Überspringen
            </Button>
          )}
          {actions.includes('submit') && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => handleActionClick('submit')}
              disabled={busy}
              className="gap-1.5"
              data-testid="learner-answer-submit"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Antwort prüfen
            </Button>
          )}
        </div>
      </div>

      {(voiceError || submitError) && (
        <p className="text-xs text-warning" role="status">
          {submitError ?? voiceError}
        </p>
      )}
    </div>
  );
}

export default LearnerAnswerSurface;
