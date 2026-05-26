import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileText, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FundingReportPreview } from "@/components/foerdermittel/FundingReportPreview";
import { CrossOsUpsellList } from "@/components/foerdermittel/CrossOsUpsellList";
import {
  buildFundingReportSummary,
  type FundingReportSummary,
} from "@/lib/foerdermittel/conversion";
import { matchPrograms } from "@/lib/foerdermittel/matching";
import { getProgramBySlug } from "@/lib/foerdermittel/registry";
import { supabase } from "@/integrations/supabase/client";
import type { ProgramMatch, CompanyProfile } from "@/lib/foerdermittel/types";

interface StoredReport {
  matches: { slug: string; fit: number; probability: number }[];
  profile: Partial<CompanyProfile>;
  generatedAt: string;
  quality?: { score: number; tier: string };
}

export default function FoerdermittelReportPage() {
  const { reportKey = "" } = useParams<{ reportKey: string }>();
  const [stored, setStored] = useState<StoredReport | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`fmos.report.${reportKey}`);
      if (raw) setStored(JSON.parse(raw));
    } catch { /* ignore */ }
    void supabase.from("conversion_events").insert({
      event_type: "funding_report_generated",
      page_path: `/foerdermittel/report/${reportKey}`,
      metadata: { module: "foerdermittel", report_key: reportKey.slice(0, 64) },
    });
  }, [reportKey]);

  const report: FundingReportSummary | null = useMemo(() => {
    if (!stored) return null;
    // Rehydrate matches deterministically from registry
    const matches: ProgramMatch[] = stored.matches
      .map((m): ProgramMatch | null => {
        const program = getProgramBySlug(m.slug);
        if (!program) return null;
        return {
          program,
          fit: m.fit,
          probability: m.probability,
          reasons: [] as string[],
          warnings: [] as string[],
          disqualifiers: [] as string[],
        };
      })
      .filter((m): m is ProgramMatch => m !== null);

    // If no matches stored but profile present, recompute
    const finalMatches: ProgramMatch[] = matches.length > 0
      ? matches
      : stored.profile.size && stored.profile.region
        ? matchPrograms(stored.profile as CompanyProfile).slice(0, 5)
        : [];

    return buildFundingReportSummary({
      matchResults: finalMatches,
      profile: stored.profile,
      reportKey,
      now: new Date(stored.generatedAt),
    });
  }, [stored, reportKey]);

  return (
    <main className="min-h-screen bg-background">
      {/* CRITICAL: personal report must NEVER be indexed */}
      <Helmet>
        <title>Ihr Fördermittel-Report · FördermittelOS</title>
        <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
        <meta name="description" content="Persönlicher Fördermittel-Report. Nicht öffentlich indexiert." />
      </Helmet>

      <section className="mx-auto max-w-5xl px-6 pt-8 pb-2">
        <Link to="/foerdermittel" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> FördermittelOS-Hub
        </Link>
      </section>

      <section className="mx-auto max-w-5xl px-6 pt-2 pb-6">
        <Badge variant="outline" className="mb-2">Persönlicher Report · nicht öffentlich</Badge>
        <h1 className="text-3xl font-semibold tracking-tight inline-flex items-center gap-2">
          <FileText className="h-7 w-7 text-primary" />
          Ihr Fördermittel-Report
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Report-ID: <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{reportKey}</code>
          {stored?.generatedAt && (
            <> · erstellt {new Date(stored.generatedAt).toLocaleString("de-DE")}</>
          )}
        </p>
      </section>

      {!report ? (
        <section className="mx-auto max-w-5xl px-6 pb-12">
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <Sparkles className="h-8 w-8 text-muted-foreground mx-auto" />
              <div className="font-semibold">Dieser Report ist auf diesem Gerät nicht verfügbar.</div>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Reports werden lokal pro Browser-Session vorgehalten. Eine Kopie wurde Ihnen per
                E-Mail zugestellt. Sie können den Fördermittel-Check jederzeit erneut starten.
              </p>
              <Link to="/foerdermittel" className="text-sm text-primary hover:underline inline-block">
                Zum Hub
              </Link>
            </CardContent>
          </Card>
        </section>
      ) : (
        <section className="mx-auto max-w-5xl px-6 pb-12 space-y-6">
          <FundingReportPreview report={report} />
          <CrossOsUpsellList
            recommendations={report.crossOsRecommendations}
            onClick={(rec) => {
              void supabase.from("conversion_events").insert({
                event_type: "cross_os_recommendation_clicked",
                page_path: `/foerdermittel/report/${reportKey}`,
                metadata: {
                  module: "foerdermittel",
                  report_key: reportKey.slice(0, 64),
                  target_os: rec.os,
                  cta: rec.cta,
                  priority: rec.priority,
                },
              });
            }}
          />
          <p className="text-[11px] text-muted-foreground text-center pt-2">
            FördermittelOS ersetzt keine verbindliche Förderberatung. Stand und Konditionen jedes
            Programms vor Antragstellung bei der offiziellen Förderstelle prüfen.
          </p>
        </section>
      )}
    </main>
  );
}
