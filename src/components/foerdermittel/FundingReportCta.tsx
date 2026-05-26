import { useState } from "react";
import { Sparkles, FileText, ShieldCheck, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LeadCaptureDialog } from "./LeadCaptureDialog";
import { buildLeadMagnetOffer, type LeadSourcePage } from "@/lib/foerdermittel/conversion";
import type { CompanyProfile, ProgramMatch } from "@/lib/foerdermittel/types";

interface Props {
  source: LeadSourcePage;
  matches?: ReadonlyArray<ProgramMatch>;
  profile?: Partial<CompanyProfile> | null;
  variant?: "primary" | "compact" | "inline";
  className?: string;
}

export function FundingReportCta({ source, matches = [], profile, variant = "primary", className }: Props) {
  const [open, setOpen] = useState(false);
  const staleCount = matches.filter((m) => m.warnings.length > 0).length;
  const offer = buildLeadMagnetOffer({
    hasMatches: matches.length > 0,
    topCount: Math.min(matches.length, 5),
    staleCount,
    source,
  });

  if (variant === "inline") {
    return (
      <>
        <Button onClick={() => setOpen(true)} className={className}>
          <FileText className="h-4 w-4 mr-1" />
          {offer.ctaLabel}
        </Button>
        <LeadCaptureDialog open={open} onOpenChange={setOpen} source={source} matches={matches} profile={profile} />
      </>
    );
  }

  if (variant === "compact") {
    return (
      <>
        <Card className={`border-primary/30 ${className ?? ""}`}>
          <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <Sparkles className="h-5 w-5 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{offer.headline}</div>
              <p className="text-sm text-muted-foreground mt-0.5">{offer.subline}</p>
            </div>
            <Button onClick={() => setOpen(true)} className="flex-shrink-0">
              {offer.ctaLabel} <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
        <LeadCaptureDialog open={open} onOpenChange={setOpen} source={source} matches={matches} profile={profile} />
      </>
    );
  }

  return (
    <>
      <Card className={`border-primary/40 bg-gradient-to-br from-background to-primary/[0.04] ${className ?? ""}`}>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-primary/10 p-2">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <Badge variant="outline" className="mb-1.5">Premium · kostenlos</Badge>
              <h3 className="text-lg font-semibold">{offer.headline}</h3>
              <p className="text-sm text-muted-foreground mt-1">{offer.subline}</p>
            </div>
          </div>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {offer.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button size="lg" onClick={() => setOpen(true)}>
              {offer.ctaLabel} <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
            <span className="text-[11px] text-muted-foreground">{offer.trustLine}</span>
          </div>
        </CardContent>
      </Card>
      <LeadCaptureDialog open={open} onOpenChange={setOpen} source={source} matches={matches} profile={profile} />
    </>
  );
}
