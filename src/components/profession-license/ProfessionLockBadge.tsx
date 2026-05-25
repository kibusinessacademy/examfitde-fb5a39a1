import { Lock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  title: string;
  reason: string;
  benefit?: string;
  ctaLabel?: string;
  onUpgrade?: () => void;
  preview?: React.ReactNode;
}

/**
 * SSOT Lock-UI für berufsfeld-gebundene Features.
 * Zeigt Lock-Badge + Berufsfeld-Hinweis + Nutzenargument + Upgrade CTA.
 */
export function ProfessionLockBadge({ title, reason, benefit, ctaLabel = "Berufsfeld freischalten", onUpgrade, preview }: Props) {
  return (
    <Card className="border-dashed border-border bg-surface-subtle">
      <CardContent className="p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <Lock className="h-3 w-3" /> Gesperrt
          </Badge>
          <span className="text-sm font-medium text-text-primary">{title}</span>
        </div>
        <p className="text-sm text-text-secondary">{reason}</p>
        {benefit && (
          <p className="text-sm text-text-primary flex items-start gap-2">
            <Sparkles className="h-4 w-4 text-primary mt-0.5" /> {benefit}
          </p>
        )}
        {preview && <div className="opacity-50 pointer-events-none">{preview}</div>}
        {onUpgrade && (
          <Button size="sm" onClick={onUpgrade}>{ctaLabel}</Button>
        )}
      </CardContent>
    </Card>
  );
}
