import RiskBadge from "@/components/b2b/RiskBadge";
import type { OrgPerformanceRow } from "@/hooks/useOrgPerformance";
import { AlertTriangle, Clock, TrendingDown } from "lucide-react";

function riskToVerdict(risk: string): string {
  switch (risk) {
    case 'low': return 'exam_ready';
    case 'medium': return 'almost_ready';
    case 'high': return 'not_ready';
    case 'not_started': return 'needs_work';
    default: return risk;
  }
}

function getCriticalReasons(row: OrgPerformanceRow): string[] {
  const reasons: string[] = [];
  if (row.readiness_score < 40) {
    reasons.push(`Prüfungsreife nur ${Math.round(row.readiness_score)}% – hohe Durchfallwahrscheinlichkeit`);
  } else if (row.readiness_score < 60) {
    reasons.push(`Prüfungsreife bei ${Math.round(row.readiness_score)}% – noch nicht prüfungsbereit`);
  }
  if (row.inactive_days > 14) {
    reasons.push(`${row.inactive_days} Tage inaktiv – kein Lernfortschritt`);
  }
  if (row.last_exam_score > 0 && row.last_exam_score < 50) {
    reasons.push(`Letzte Prüfung nur ${Math.round(row.last_exam_score)}% – Wissenslücken`);
  }
  if (row.progress_pct < 30) {
    reasons.push(`Nur ${Math.round(row.progress_pct)}% Fortschritt – weit zurück`);
  }
  return reasons;
}

interface Props {
  row: OrgPerformanceRow;
  onClickRow?: (row: OrgPerformanceRow) => void;
}

export default function CriticalCaseRow({ row, onClickRow }: Props) {
  const reasons = getCriticalReasons(row);

  return (
    <div
      className={`flex flex-col gap-1.5 py-3 ${onClickRow ? 'cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded-lg transition-colors' : ''}`}
      onClick={() => onClickRow?.(row)}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-sm">{row.display_name}</div>
          <div className="text-xs text-muted-foreground">
            {row.product_title} · {Math.round(row.readiness_score)}% Prüfungsreife
            {row.inactive_days > 14 && ` · ${row.inactive_days} Tage inaktiv`}
          </div>
        </div>
        <RiskBadge verdict={riskToVerdict(row.risk_level)} />
      </div>

      {reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {reasons.map((reason, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
            >
              {row.inactive_days > 14 && reason.includes('inaktiv') ? (
                <Clock className="h-3 w-3" />
              ) : reason.includes('Durchfall') ? (
                <AlertTriangle className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {reason}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export { riskToVerdict };
