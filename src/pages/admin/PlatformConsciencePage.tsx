import { Link } from "react-router-dom";
import { Shield, TrendingUp, Cpu, ArrowRight, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminPageHeader } from "@/components/admin/v2/AdminPageHeader";
import { LoadingState } from "@/components/admin/ops/LoadingState";
import { ErrorState } from "@/components/admin/ops/ErrorState";
import { usePlatformConscienceSummary } from "@/features/admin/usePlatformConscienceSummary";
import { formatDateTime } from "@/components/admin/lib/admin-utils";

/**
 * P20 Cut 0C — Unified Platform Conscience Hub
 * ────────────────────────────────────────────
 * Read-only entry point for the three platform-awareness pillars:
 *   • Architecture Governance / P18 → /admin/governance/architecture
 *   • Growth Intelligence / P19     → /admin/growth-intelligence
 *   • AI Runtime Center             → /admin/runtime
 *
 * No heal-/briefing-/signal-buttons in this hub. Status + navigation only.
 * Backed by `admin_get_platform_conscience_summary` (read-only, admin-gated).
 */
export default function PlatformConsciencePage() {
  const { data, isLoading, isError } = usePlatformConscienceSummary();

  return (
    <div className="space-y-4" data-testid="platform-conscience-hub">
      <AdminPageHeader
        icon={Sparkles}
        title="Platform Conscience"
        description="SSOT-Hub für die drei Plattform-Säulen: Architecture Governance · Growth Intelligence · AI Runtime."
        documentTitle="Platform Conscience · ExamFit Admin"
        badges={
          <>
            <Badge variant="outline" className="text-[10px]">v1 · read-only</Badge>
            <Badge variant="secondary" className="text-[10px]">P20 Cut 0C</Badge>
          </>
        }
      />

      {isLoading ? (
        <LoadingState label="Lade Plattform-Status…" />
      ) : isError || !data ? (
        <ErrorState label="Plattform-Status konnte nicht geladen werden." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <PillarCard
            testId="pillar-p18"
            icon={<Shield className="h-5 w-5" />}
            title="Architecture Governance"
            subtitle="P18 · Semantic Drift Forensics + Bounded Heal"
            href="/admin/governance/architecture"
            kpis={[
              { label: "Open drifts", value: data.p18.open_drifts },
              { label: "Blocked", value: data.p18.blocked_findings },
              { label: "Healed", value: data.p18.healed_count },
              { label: "Rejected", value: data.p18.rejected_count },
            ]}
            lastActivity={
              data.p18.last_entry_at
                ? `Letzter Ledger-Eintrag: ${data.p18.last_entry_drift_type ?? "—"} · ${data.p18.last_entry_status ?? "—"} · ${formatDateTime(data.p18.last_entry_at)}`
                : "Noch keine Ledger-Einträge."
            }
          />

          <PillarCard
            testId="pillar-gil"
            icon={<TrendingUp className="h-5 w-5" />}
            title="Growth Intelligence"
            subtitle="P19 · Market Signals + Executive Briefings"
            href="/admin/growth-intelligence"
            kpis={[
              { label: "Market signals", value: data.gil.market_signals_total },
              { label: "P18-Drift-Signale", value: data.gil.internal_drift_signals },
              { label: "Offene Empfehlungen", value: data.gil.open_recommendations },
              { label: "Kritisch", value: data.gil.critical_signals },
            ]}
            lastActivity={
              data.gil.last_briefing_at
                ? `Letztes Briefing: „${data.gil.last_briefing_headline ?? "—"}" · ${formatDateTime(data.gil.last_briefing_at)}`
                : data.gil.last_signal_at
                  ? `Letztes Signal: ${formatDateTime(data.gil.last_signal_at)}`
                  : "Noch keine Signale oder Briefings."
            }
          />

          <PillarCard
            testId="pillar-runtime"
            icon={<Cpu className="h-5 w-5" />}
            title="AI Runtime Center"
            subtitle="AI Eval · Policy Governance · Observability"
            href="/admin/runtime"
            kpis={[
              { label: "AI runs total", value: data.runtime.ai_runs_total },
              { label: "Failed (7d)", value: data.runtime.ai_runs_failed_7d },
              { label: "Succeeded (7d)", value: data.runtime.ai_runs_succeeded_7d },
              { label: "Active policies", value: data.runtime.policy_versions_active },
            ]}
            lastActivity={
              data.runtime.last_run_at
                ? `Letzter AI-Run: ${formatDateTime(data.runtime.last_run_at)}`
                : "Noch keine AI-Runs erfasst."
            }
          />
        </div>
      )}
    </div>
  );
}

interface PillarCardProps {
  testId: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  href: string;
  kpis: Array<{ label: string; value: number }>;
  lastActivity: string;
}

function PillarCard({ testId, icon, title, subtitle, href, kpis, lastActivity }: PillarCardProps) {
  return (
    <Card variant="interactive" data-testid={testId} className="flex flex-col">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2 text-text-secondary">
          {icon}
          <span className="text-xs uppercase tracking-[0.18em]">{subtitle}</span>
        </div>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription className="text-xs">{lastActivity}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-lg border border-border-subtle bg-surface-sunken p-3">
              <div className="text-[10px] uppercase tracking-wider text-text-tertiary">{k.label}</div>
              <div className="mt-1 text-xl font-semibold text-text-primary">{k.value ?? 0}</div>
            </div>
          ))}
        </div>
        <Link
          to={href}
          data-testid={`${testId}-link`}
          className="mt-auto inline-flex items-center justify-between rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:border-border-strong"
        >
          <span>Detailansicht öffnen</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
}
