/**
 * Section-Header für Learner-Sektionen — konsistent über Dashboard/Course/Profile.
 *
 * Rein präsentational. Eyebrow + Headline + Subtext + optionale Action.
 */
import { cn } from "@/lib/utils";

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

export function LearnerSectionHeader({
  eyebrow,
  title,
  subtitle,
  action,
  className,
}: Props) {
  return (
    <header
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        {eyebrow && (
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h2 className="font-display text-xl sm:text-2xl leading-tight">{title}</h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground max-w-2xl">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
