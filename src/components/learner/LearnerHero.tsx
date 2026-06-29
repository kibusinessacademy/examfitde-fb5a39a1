/**
 * Learner Premium Hero — Pendant zum Shop ProductHero.
 *
 * Visuelle Grammatik: großes Berufs-/Kursbild, sanftes Overlay, Greeting +
 * KPI-Pills (Lernstreak, offene Aufgaben), optionaler primärer CTA.
 *
 * Rein präsentational. Bild via `resolveCourseImage`, kein DB-Read.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Flame, Target } from "lucide-react";
import {
  LEARNER_HERO_SIZES,
  resolveCourseImage,
} from "@/lib/learnerImage";
import { cn } from "@/lib/utils";

export interface LearnerHeroKpi {
  icon?: React.ReactNode;
  label: string;
  value: string;
}

interface Props {
  eyebrow?: string;
  greeting: string;
  subtitle?: string;
  imageUrl?: string | null;
  imageTitleHint?: string;
  imageChamberHint?: string | null;
  kpis?: ReadonlyArray<LearnerHeroKpi>;
  primaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  className?: string;
}

export function LearnerHero({
  eyebrow,
  greeting,
  subtitle,
  imageUrl,
  imageTitleHint,
  imageChamberHint,
  kpis,
  primaryAction,
  className,
}: Props) {
  const src = resolveCourseImage({
    explicit: imageUrl,
    title: imageTitleHint ?? greeting,
    chamber: imageChamberHint ?? null,
  });

  const defaultKpis: LearnerHeroKpi[] = [];
  const items = kpis && kpis.length > 0 ? kpis : defaultKpis;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl border bg-card/50",
        className,
      )}
      aria-label="Lern-Übersicht"
    >
      <div className="absolute inset-0">
        <img
          src={src}
          alt=""
          width={1600}
          height={900}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          sizes={LEARNER_HERO_SIZES}
          className="h-full w-full object-cover"
          aria-hidden
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/70 to-background/30" />
      </div>

      <div className="relative grid gap-6 p-6 sm:p-10 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div className="space-y-3">
          {eyebrow && (
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl leading-tight">
            {greeting}
          </h1>
          {subtitle && (
            <p className="max-w-xl text-sm sm:text-base text-muted-foreground">
              {subtitle}
            </p>
          )}
          {primaryAction && (
            <div className="pt-2">
              <Button
                asChild={!!primaryAction.href}
                onClick={primaryAction.onClick}
                className="gradient-primary text-primary-foreground border-0 h-11 px-5"
              >
                {primaryAction.href ? (
                  <a href={primaryAction.href} className="inline-flex items-center gap-2">
                    {primaryAction.label}
                    <ArrowRight className="h-4 w-4" />
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    {primaryAction.label}
                    <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </Button>
            </div>
          )}
        </div>

        {items.length > 0 && (
          <ul className="flex flex-wrap gap-2 lg:justify-end" aria-label="Kennzahlen">
            {items.map((k, i) => (
              <li key={`${k.label}-${i}`}>
                <Badge
                  variant="secondary"
                  className="gap-1.5 px-3 py-1.5 text-xs backdrop-blur-md bg-background/60 border border-border/60"
                >
                  <span className="text-foreground/80" aria-hidden>
                    {k.icon ?? <Target className="h-3.5 w-3.5" />}
                  </span>
                  <span className="text-muted-foreground">{k.label}</span>
                  <span className="font-semibold text-foreground">{k.value}</span>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export const LEARNER_HERO_ICONS = {
  streak: <Flame className="h-3.5 w-3.5" />,
  target: <Target className="h-3.5 w-3.5" />,
};
