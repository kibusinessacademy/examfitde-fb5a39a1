/**
 * Empty-State für Learner-Listen/Sektionen.
 *
 * Rein präsentational. Optionaler Icon-/Illustration-Slot + CTA.
 */
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function LearnerEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
  icon,
  className,
}: Props) {
  return (
    <Card
      className={cn(
        "rounded-2xl border-dashed bg-card/40 p-8 text-center flex flex-col items-center gap-3",
        className,
      )}
    >
      <div
        className="h-12 w-12 rounded-full bg-muted/60 grid place-items-center text-muted-foreground"
        aria-hidden
      >
        {icon ?? <Sparkles className="h-5 w-5" />}
      </div>
      <h3 className="font-display text-base">{title}</h3>
      {description && (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      )}
      {actionLabel && (actionHref || onAction) && (
        <Button
          asChild={!!actionHref}
          onClick={onAction}
          className="gradient-primary text-primary-foreground border-0 h-10"
        >
          {actionHref ? <a href={actionHref}>{actionLabel}</a> : <span>{actionLabel}</span>}
        </Button>
      )}
    </Card>
  );
}
