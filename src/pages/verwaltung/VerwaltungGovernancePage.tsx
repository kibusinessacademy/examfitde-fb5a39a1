/**
 * /admin/verwaltung/governance — Cut A3
 * Governance Intelligence Layer:
 *  - Audit-Trail (verwaltungs-relevante Heal-Events)
 *  - Refusal-Quality pro Department
 *  - Source-Coverage / Dead-Workflow-Detection
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getVerwaltungGovernanceAuditTrail,
  getVerwaltungGovernanceRefusalQuality,
  getVerwaltungGovernanceSourceCoverage,
  type VGovernanceAuditEvent,
  type VGovernanceRefusalDept,
  type VGovernanceDeadWorkflow,
  type VGovernanceCoverageDept,
} from "@/lib/berufs-ki/occupational-intelligence";

const refusalTone = (c: VGovernanceRefusalDept["classification"]) => {
  switch (c) {
    case "OK":
      return "bg-status-ok-subtle text-status-ok-fg border-status-ok-border";
    case "OVER_REFUSING":
      return "bg-status-warn-subtle text-status-warn-fg border-status-warn-border";
    case "LOW_QUALITY_REFUSALS":
      return "bg-status-crit-subtle text-status-crit-fg border-status-crit-border";
    case "NO_REFUSALS":
      return "bg-status-info-subtle text-status-info-fg border-status-info-border";
    default:
      return "bg-surface-2 text-text-muted border-border-subtle";
  }
};

const categoryTone = (c: VGovernanceAuditEvent["audit_category"]) => {
  switch (c) {
    case "verwaltung_native":
      return "bg-status-info-subtle text-status-info-fg border-status-info-border";
    case "tutor_governance":
      return "bg-status-ok-subtle text-status-ok-fg border-status-ok-border";
    case "refusal_event":
      return "bg-status-warn-subtle text-status-warn-fg border-status-warn-border";
    default:
      return "bg-surface-2 text-text-muted border-border-subtle";
  }
};

const coverageTone = (s: VGovernanceDeadWorkflow["coverage_status"]) =>
  s === "DEAD_WORKFLOW"
    ? "bg-status-crit-subtle text-status-crit-fg border-status-crit-border"
    : "bg-status-warn-subtle text-status-warn-fg border-status-warn-border";

export default function VerwaltungGovernancePage() {
  const audit = useQuery({
    queryKey: ["verwaltung-gov-audit", 7],
    queryFn: () => getVerwaltungGovernanceAuditTrail(7, 100),
    staleTime: 60_000,
  });

  const refusal = useQuery({
    queryKey: ["verwaltung-gov-refusal", 14],
    queryFn: () => getVerwaltungGovernanceRefusalQuality(14),
    staleTime: 60_000,
  });

  const coverage = useQuery({
    queryKey: ["verwaltung-gov-coverage", 30],
    queryFn: () => getVerwaltungGovernanceSourceCoverage(30),
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-text-muted">
          VerwaltungsOS · Cut A3
        </p>
        <h1 className="text-3xl font-semibold text-text-primary">
          Governance Intelligence
        </h1>
        <p className="max-w-3xl text-text-secondary">
          AI-Audit-Trail, Refusal-Quality und Source-Coverage über alle 128
          Fachverfahren — die lebende Compliance-Sicht des VerwaltungsOS.
        </p>
      </header>

      {/* AUDIT TRAIL */}
      <Card className="border-border-subtle bg-surface-1 p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-text-primary">
            AI-Audit-Trail (7 Tage)
          </h2>
          <span className="text-xs text-text-muted">
            Quelle: auto_heal_log · verwaltungs-relevante Events
          </span>
        </div>

        {audit.isLoading && <p className="text-text-muted">Lade …</p>}
        {audit.data && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Events gesamt" value={audit.data.summary.total_events} />
              {Object.entries(audit.data.summary.by_category).map(([k, v]) => (
                <Kpi key={k} label={k} value={v} />
              ))}
            </div>

            <div className="max-h-96 overflow-auto rounded border border-border-subtle">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2 text-text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left">Zeit</th>
                    <th className="px-3 py-2 text-left">Kategorie</th>
                    <th className="px-3 py-2 text-left">Action</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.recent.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                        Keine Events im Fenster.
                      </td>
                    </tr>
                  )}
                  {audit.data.recent.map((e) => (
                    <tr key={e.id} className="border-t border-border-subtle">
                      <td className="px-3 py-2 text-text-muted">
                        {new Date(e.created_at).toLocaleString("de-DE")}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={categoryTone(e.audit_category)}>
                          {e.audit_category}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-text-primary">
                        {e.action_type}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        {e.result_status ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-text-muted">
                        {e.target_type ? `${e.target_type}:${e.target_id ?? "—"}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* REFUSAL QUALITY */}
      <Card className="border-border-subtle bg-surface-1 p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-text-primary">
            Refusal-Quality (14 Tage)
          </h2>
          <span className="text-xs text-text-muted">
            Heuristik: system-turns + Refusal-Phrasen
          </span>
        </div>

        {refusal.isLoading && <p className="text-text-muted">Lade …</p>}
        {refusal.data && (
          <>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <Kpi label="Turns" value={refusal.data.totals.turns} />
              <Kpi label="Refusals" value={refusal.data.totals.refusals} />
              <Kpi
                label="Qualified-Refusals"
                value={refusal.data.totals.refusals_qualified}
              />
            </div>

            {refusal.data.by_department.length === 0 ? (
              <div className="rounded border border-border-subtle bg-surface-2 p-4 text-sm text-text-muted space-y-2">
                <p>
                  Noch keine Oral-Sessions im Fenster — Refusal-Telemetrie startet
                  automatisch mit der ersten Sitzung.
                </p>
                <Link
                  to="/app/oral"
                  className="inline-flex items-center text-primary hover:underline"
                >
                  Oral-Exam Übersicht öffnen →
                </Link>
              </div>
            ) : (
              <div className="overflow-auto rounded border border-border-subtle">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">Department</th>
                      <th className="px-3 py-2 text-right">Turns</th>
                      <th className="px-3 py-2 text-right">Refusals</th>
                      <th className="px-3 py-2 text-right">Refusal-Rate</th>
                      <th className="px-3 py-2 text-right">Qualified-Rate</th>
                      <th className="px-3 py-2 text-left">Klassifikation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refusal.data.by_department.map((d) => (
                      <tr
                        key={d.department_key}
                        className="border-t border-border-subtle"
                      >
                        <td className="px-3 py-2 text-text-primary">
                          {d.department_key}
                        </td>
                        <td className="px-3 py-2 text-right">{d.total_turns}</td>
                        <td className="px-3 py-2 text-right">{d.refusal_turns}</td>
                        <td className="px-3 py-2 text-right">{d.refusal_rate}%</td>
                        <td className="px-3 py-2 text-right">{d.qualified_rate}%</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={refusalTone(d.classification)}>
                            {d.classification}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      {/* SOURCE COVERAGE */}
      <Card className="border-border-subtle bg-surface-1 p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold text-text-primary">
            Source-Coverage & Dead-Workflow-Detection (30 Tage)
          </h2>
          <span className="text-xs text-text-muted">
            128 Fachverfahren · Aktivität × Metadaten-Tiefe
          </span>
        </div>

        {coverage.isLoading && <p className="text-text-muted">Lade …</p>}
        {coverage.data && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              <Kpi label="Workflows" value={coverage.data.totals.workflows} />
              <Kpi label="Covered" value={coverage.data.totals.covered} tone="ok" />
              <Kpi label="Dead" value={coverage.data.totals.dead} tone="crit" />
              <Kpi
                label="No-Activity"
                value={coverage.data.totals.no_activity}
                tone="warn"
              />
              <Kpi
                label="Metadata-Gap"
                value={coverage.data.totals.metadata_gap}
                tone="warn"
              />
            </div>

            {coverage.data.dead_workflows.length > 0 && (
              <div className="mb-4">
                <h3 className="mb-2 text-sm font-semibold text-text-primary">
                  Top Dead/Gap Workflows
                </h3>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {coverage.data.dead_workflows.slice(0, 12).map((w) => (
                    <div
                      key={`${w.department_key}/${w.workflow_key}`}
                      className="rounded border border-border-subtle bg-surface-2 p-3"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-text-primary">
                          {w.workflow_name}
                        </span>
                        <Badge variant="outline" className={coverageTone(w.coverage_status)}>
                          {w.coverage_status}
                        </Badge>
                      </div>
                      <p className="text-xs text-text-muted">
                        {w.department_key} · {w.category}
                      </p>
                      <p className="mt-1 text-xs text-text-secondary">
                        kpi:{w.kpi_count} · esc:{w.escalation_count} · auto:{w.automation_count}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <details className="rounded border border-border-subtle bg-surface-2 p-3">
              <summary className="cursor-pointer text-sm font-medium text-text-primary">
                Coverage pro Department ({coverage.data.by_department.length})
              </summary>
              <div className="mt-3 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-text-muted">
                    <tr>
                      <th className="px-2 py-1 text-left">Department</th>
                      <th className="px-2 py-1 text-right">Total</th>
                      <th className="px-2 py-1 text-right">Covered</th>
                      <th className="px-2 py-1 text-right">Dead</th>
                      <th className="px-2 py-1 text-right">NoAct</th>
                      <th className="px-2 py-1 text-right">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.data.by_department.map((d: VGovernanceCoverageDept) => (
                      <tr key={d.department_key} className="border-t border-border-subtle">
                        <td className="px-2 py-1 text-text-primary">{d.department_key}</td>
                        <td className="px-2 py-1 text-right">{d.workflow_count}</td>
                        <td className="px-2 py-1 text-right text-status-ok-fg">
                          {d.covered_count}
                        </td>
                        <td className="px-2 py-1 text-right text-status-crit-fg">
                          {d.dead_count}
                        </td>
                        <td className="px-2 py-1 text-right text-status-warn-fg">
                          {d.no_activity_count}
                        </td>
                        <td className="px-2 py-1 text-right text-status-warn-fg">
                          {d.metadata_gap_count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "ok" | "warn" | "crit";
}) {
  const toneClass =
    tone === "ok"
      ? "text-status-ok-fg"
      : tone === "warn"
      ? "text-status-warn-fg"
      : tone === "crit"
      ? "text-status-crit-fg"
      : "text-text-primary";
  return (
    <div className="rounded border border-border-subtle bg-surface-2 p-3">
      <p className="text-xs uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
