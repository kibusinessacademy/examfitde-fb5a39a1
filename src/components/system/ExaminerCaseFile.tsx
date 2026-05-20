/**
 * Phase 8.5 — Examiner Case File (Prüfungsakte).
 *
 * Ruhige, professionelle Visualisierung der prüferischen Wahrheit.
 * Keine Gamification, keine Animationen — Aktencharakter.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useExaminerConsciousness } from "@/lib/examiner/ExaminerConsciousness";
import { ReadinessTimeline } from "./ReadinessTimeline";
import { CompetencyRiskMap } from "./CompetencyRiskMap";
import { ExaminerSummaryPanel } from "./ExaminerSummaryPanel";
import { EvidenceHistoryTimeline } from "./EvidenceHistoryTimeline";
import { FileText } from "lucide-react";

interface Props {
  className?: string;
}

export function ExaminerCaseFile({ className }: Props) {
  const ex = useExaminerConsciousness();

  return (
    <Card className={`bg-surface-raised border-border-subtle shadow-elev-1 ${className ?? ""}`}>
      <CardHeader className="pb-3 border-b border-border-subtle">
        <CardTitle className="text-base font-display flex items-center gap-2 text-text-primary">
          <FileText className="h-4 w-4 text-text-secondary" />
          Prüfungsakte
        </CardTitle>
        <p className="text-xs text-text-tertiary mt-1">
          Prüferische Einschätzung · Aktenstand {new Date().toLocaleDateString("de-DE")}
        </p>
      </CardHeader>
      <CardContent className="p-5 space-y-6">
        <ExaminerSummaryPanel
          verdict={ex.deliberation.verdict}
          authorityStatus={ex.authority.status}
          confidence={ex.deliberation.confidence}
          readiness={ex.readiness}
        />
        <ReadinessTimeline trend={ex.trend} stability={ex.stability} />
        <CompetencyRiskMap risks={ex.topRisks} recurring={ex.recurring} />
        <EvidenceHistoryTimeline chains={[ex.verdictEvidence, ex.readinessEvidence, ...ex.topRiskEvidence]} />
      </CardContent>
    </Card>
  );
}
