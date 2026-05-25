/**
 * Berufs-KI Locked Workflow Preview (BK-Act-2).
 *
 * Outcome-Selling für tier-gesperrte Workflows. Zeigt:
 *  - was der Workflow erreicht (Outcome)
 *  - typischer Use Case
 *  - Zeitersparnis pro Lauf
 *  - Output-Sektionen als „Was du bekommst"-Vorschau
 *  - Bindungs-Chips (Lernpaket / Kompetenz)
 *  - Upgrade-CTA
 */
import { Lock, Clock, Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CATEGORY_LABEL, tierLabel } from "@/lib/berufs-ki/copy";
import { useLockedWorkflowPreview } from "@/hooks/useBerufsKiRevenueUX";
import type { WorkflowCategory } from "@/lib/berufs-ki/types";

interface Props {
  slug: string;
  onClose?: () => void;
}

export function LockedWorkflowPreview({ slug, onClose }: Props) {
  const { data, isLoading } = useLockedWorkflowPreview(slug);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Lade Vorschau…
        </CardContent>
      </Card>
    );
  }
  if (!data || data.error) return null;

  const isBusiness = data.tier_required === "business";
  const cta = isBusiness
    ? { label: "Business-Lizenz prüfen", to: "/work" }
    : { label: "Lernpaket freischalten", to: "/paket" };

  return (
    <Card className="overflow-hidden border-primary/30">
      <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-background p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            {CATEGORY_LABEL[data.category as WorkflowCategory] ?? data.category}
          </Badge>
          <Badge className="gap-1 text-[10px]">
            <Lock className="h-2.5 w-2.5" />
            {tierLabel(data.tier_required)}
          </Badge>
          {data.has_curriculum_binding && (
            <Badge variant="outline" className="text-[10px]">Lernpaket-Bindung</Badge>
          )}
          {data.has_competency_binding && (
            <Badge variant="outline" className="text-[10px]">Kompetenz-Bezug</Badge>
          )}
        </div>
        <h2 className="mt-3 text-xl font-bold leading-tight">{data.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{data.description}</p>
      </div>

      <CardContent className="space-y-5 p-5">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Was du erreichst
          </div>
          <p className="mt-1.5 text-sm font-medium leading-snug">{data.outcome}</p>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            ca. {data.estimated_time_saved_minutes} Min Zeitersparnis pro Lauf
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Typischer Use Case
          </div>
          <p className="mt-1 text-sm">{data.use_case}</p>
        </div>

        {data.output_sample_sections.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Was du bekommst (strukturierter Output)
            </div>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {data.output_sample_sections.map((s) => (
                <li key={s} className="flex items-start gap-1.5 text-sm">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>{s.replace(/_/g, " ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button asChild>
            <Link to={cta.to}>
              {cta.label} <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
          {onClose && (
            <Button variant="ghost" onClick={onClose}>
              Später
            </Button>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">
            Aktuell: {tierLabel(data.tier_actual)} · Benötigt: {tierLabel(data.tier_required)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
