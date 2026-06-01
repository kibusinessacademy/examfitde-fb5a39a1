import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** When true, the "examiner is thinking" beat is shown. */
  active: boolean;
  /** Dual = zwei Prüfer-Avatare (links/rechts), Single = einer. */
  examinerMode?: "single" | "dual" | string;
  /** Optionaler Untertitel (sonst Default). */
  caption?: string;
  className?: string;
}

/**
 * "Prüfer denkt nach…" — cinematic beat between answer-submit and follow-up TTS.
 *
 * Pure presentation. Reuses Premium Motion Foundation v3 (animate-soft-bounce,
 * premium-shimmer, premium-reveal, glow-pulse). No audio, no state — driven
 * entirely by the `active` prop from the parent (typically: `isLoading`).
 */
export function ExaminerThinkingBeat({ active, examinerMode = "single", caption, className }: Props) {
  if (!active) return null;
  const isDual = examinerMode === "dual";

  return (
    <div
      className={cn(
        "rounded-xl border border-border-subtle bg-surface-sunken/60 backdrop-blur-sm p-4 premium-reveal",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-4">
        {isDual ? (
          <div className="flex gap-2">
            <ExaminerAvatar delay={0} />
            <ExaminerAvatar delay={0.2} />
          </div>
        ) : (
          <ExaminerAvatar delay={0} />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary mb-1.5 flex items-center gap-2">
            {isDual ? "Die Prüfer beraten sich" : "Der Prüfer denkt nach"}
            <span className="inline-flex gap-0.5">
              <Dot delay="0ms" />
              <Dot delay="150ms" />
              <Dot delay="300ms" />
            </span>
          </div>
          {/* Anticipatory shimmer — signals "follow-up forms" */}
          <div className="space-y-1.5" aria-hidden="true">
            <div className="h-2 rounded-md premium-shimmer w-11/12" />
            <div className="h-2 rounded-md premium-shimmer w-2/3" />
          </div>
          {caption && (
            <p className="text-xs text-text-secondary mt-2">{caption}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ExaminerAvatar({ delay = 0 }: { delay?: number }) {
  return (
    <div
      className="h-10 w-10 rounded-full bg-petrol-100 dark:bg-petrol-800 flex items-center justify-center flex-shrink-0 animate-glow-pulse"
      style={{ animationDelay: `${delay}s` }}
    >
      <Bot className="h-5 w-5 text-petrol-700 dark:text-petrol-200" />
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full bg-text-tertiary animate-soft-bounce"
      style={{ animationDelay: delay }}
    />
  );
}
