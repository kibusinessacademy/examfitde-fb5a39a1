import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  FileText,
  Gauge,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import type { AuthorityAsset, AuthorityAssetKind } from "@/lib/authority/catalog";

const ICONS: Record<AuthorityAssetKind, typeof BookOpen> = {
  tool: Wrench,
  "risk-check": ShieldAlert,
  checklist: CheckCircle2,
  template: FileText,
  "ai-assistant": Bot,
  "legal-hub": BookOpen,
  guide: Gauge,
};

const LABELS: Record<AuthorityAssetKind, string> = {
  tool: "Interaktives Tool",
  "risk-check": "Risiko-Check",
  checklist: "Checkliste",
  template: "Vorlage",
  "ai-assistant": "KI-Assistent",
  "legal-hub": "Rechts-Hub",
  guide: "Leitfaden",
};

export function AssetCard({ asset }: { asset: AuthorityAsset }) {
  const Icon = ICONS[asset.kind];
  const Wrapper: React.ElementType = asset.live ? Link : "div";
  const wrapperProps = asset.live ? { to: asset.href } : {};

  return (
    <Wrapper {...wrapperProps} className="group block">
      <Card className="h-full transition-all hover:border-primary/40 hover:shadow-md">
        <CardContent className="p-5 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <Badge variant="outline" className="text-xs">
              {LABELS[asset.kind]}
            </Badge>
          </div>
          <div>
            <h3 className="font-semibold leading-snug">{asset.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{asset.description}</p>
          </div>
          {asset.source && (
            <div className="text-xs text-muted-foreground/80 font-mono">{asset.source}</div>
          )}
          <div className="mt-auto flex items-center gap-1 text-sm font-medium text-primary">
            {asset.live ? (
              <>
                Öffnen <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </>
            ) : (
              <span className="text-muted-foreground">Bald verfügbar</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Wrapper>
  );
}
