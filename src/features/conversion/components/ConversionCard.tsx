import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  headline: string;
  subline?: string;
  cta: string;
  onClick: () => void;
  /** Visuelle Tonalität: petrol = Hero-CTA, mint = Engagement, default = ruhig */
  tone?: "petrol" | "mint" | "default";
  className?: string;
};

export function ConversionCard({
  headline,
  subline,
  cta,
  onClick,
  tone = "petrol",
  className,
}: Props) {
  const toneStyles =
    tone === "petrol"
      ? "bg-gradient-to-br from-petrol-50 via-surface to-mint-50 dark:from-petrol-900 dark:via-surface dark:to-petrol-800 border-petrol-200 dark:border-petrol-700"
      : tone === "mint"
      ? "bg-gradient-to-br from-mint-50 to-surface dark:from-mint-900/30 dark:to-surface border-mint-200 dark:border-mint-700"
      : "bg-surface border-border-subtle";

  const buttonVariant: "petrol" | "mint" | "default" =
    tone === "mint" ? "mint" : tone === "default" ? "default" : "petrol";

  return (
    <Card
      data-density="comfortable"
      variant="raised"
      className={cn("rounded-2xl p-6 space-y-4 shadow-elev-2", toneStyles, className)}
    >
      <div className="text-lg font-semibold text-text-primary leading-tight">{headline}</div>
      {subline && <div className="text-sm text-text-secondary leading-relaxed">{subline}</div>}
      <Button
        onClick={onClick}
        variant={buttonVariant}
        size="lg"
        className="w-full group"
      >
        {cta}
        <ArrowRight className="h-4 w-4 transition-transform duration-base ease-out-expo group-hover:translate-x-0.5" />
      </Button>
    </Card>
  );
}
