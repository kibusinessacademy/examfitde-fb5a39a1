/**
 * Learner Premium Card — Pendant zu Shop `CoursePremiumCard`.
 *
 * Rein präsentational. Keine DB-/HTTP-Reads, keine Mutationen, keine Logik.
 * Visuelle Grammatik: HeyGen-Berufsbild + Glas-Badges + Gradient-CTA +
 * Progress-Pill, konsistent mit dem Shop-Design (Wave-4-Frozen).
 */
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, PlayCircle } from "lucide-react";
import {
  COURSE_CARD_SIZES,
  resolveCourseImage,
} from "@/lib/learnerImage";
import { LearnerProgressPill } from "./LearnerProgressPill";
import { cn } from "@/lib/utils";

export interface LearnerCourseCardAction {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "secondary";
}

export interface LearnerCourseCardProps {
  title: string;
  subtitle?: string;
  meta?: string;
  chamber?: string | null;
  imageUrl?: string | null;
  /** 0..1. Wenn nicht gesetzt, wird keine Progress-Pill gezeigt. */
  progress?: number;
  completedCount?: number;
  totalCount?: number;
  nextLessonLabel?: string | null;
  badges?: ReadonlyArray<string>;
  primaryAction?: LearnerCourseCardAction;
  secondaryAction?: LearnerCourseCardAction;
  /** Lazy/Eager Bild-Loading-Hint. */
  priority?: boolean;
  className?: string;
}

function ActionButton({
  action,
  variant = "primary",
}: {
  action: LearnerCourseCardAction;
  variant?: "primary" | "secondary";
}) {
  const isPrimary = (action.variant ?? variant) === "primary";
  const className = cn(
    "h-10 px-3 text-sm min-w-0",
    isPrimary && "gradient-primary text-primary-foreground border-0",
  );
  const content = (
    <>
      <span className="truncate">{action.label}</span>
      {isPrimary && <ArrowRight className="ml-1 h-4 w-4 shrink-0" />}
    </>
  );
  if (action.href) {
    return (
      <Button asChild variant={isPrimary ? "default" : "outline"} className={className}>
        <a href={action.href}>{content}</a>
      </Button>
    );
  }
  return (
    <Button
      variant={isPrimary ? "default" : "outline"}
      className={className}
      onClick={action.onClick}
    >
      {content}
    </Button>
  );
}

export function LearnerCourseCard({
  title,
  subtitle,
  meta,
  chamber,
  imageUrl,
  progress,
  completedCount,
  totalCount,
  nextLessonLabel,
  badges,
  primaryAction,
  secondaryAction,
  priority = false,
  className,
}: LearnerCourseCardProps) {
  const src = resolveCourseImage({
    explicit: imageUrl,
    title,
    chamber: chamber ?? null,
  });
  const showProgress =
    typeof progress === "number" ||
    (typeof completedCount === "number" && typeof totalCount === "number");

  return (
    <Card
      className={cn(
        "group h-full flex flex-col overflow-hidden rounded-2xl border bg-card/60 backdrop-blur-sm",
        "transition-shadow hover:shadow-elev-2",
        className,
      )}
    >
      <div className="relative aspect-[8/5] overflow-hidden">
        <img
          src={src}
          alt={title}
          width={800}
          height={500}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "low"}
          sizes={COURSE_CARD_SIZES}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-background/10 to-transparent" />
        {badges && badges.length > 0 && (
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            {badges.slice(0, 3).map((b, i) => (
              <Badge
                key={`${b}-${i}`}
                variant="secondary"
                className="text-[11px] px-2 py-0.5 backdrop-blur-md bg-background/60 border border-border/60"
              >
                {b}
              </Badge>
            ))}
          </div>
        )}
        {showProgress && (
          <div className="absolute right-3 top-3">
            <LearnerProgressPill
              progress={progress}
              completedCount={completedCount}
              totalCount={totalCount}
              glass
            />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="space-y-1">
          <h3 className="font-display text-base leading-tight line-clamp-2">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground line-clamp-2">{subtitle}</p>
          )}
        </div>

        {(meta || nextLessonLabel) && (
          <div className="space-y-1.5 text-xs text-muted-foreground">
            {nextLessonLabel && (
              <div className="flex items-center gap-1.5">
                <PlayCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">Weiter: {nextLessonLabel}</span>
              </div>
            )}
            {meta && <p className="line-clamp-1">{meta}</p>}
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          {primaryAction && <ActionButton action={primaryAction} variant="primary" />}
          {secondaryAction && (
            <ActionButton action={secondaryAction} variant="secondary" />
          )}
        </div>
      </div>
    </Card>
  );
}
