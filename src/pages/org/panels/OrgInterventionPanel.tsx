import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Loader2, AlertTriangle, ShieldAlert, RefreshCw, CheckCircle2, XCircle, Eye, BellRing, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useOrgInterventions,
  useOrgInterventionSummary,
  useScanOrgInterventions,
  useResolveIntervention,
  type OrgIntervention,
} from "@/hooks/useOrgInterventions";

interface Props {
  organizationId: string;
}

const SEVERITY_CONFIG: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  critical: { label: "Kritisch", className: "bg-danger-bg-subtle text-danger border-danger/20", icon: <ShieldAlert className="h-3.5 w-3.5" /> },
  high:     { label: "Hoch", className: "bg-danger-bg-subtle text-danger border-danger/20", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  medium:   { label: "Mittel", className: "bg-warning-bg-subtle text-warning border-warning/20", icon: <BellRing className="h-3.5 w-3.5" /> },
  low:      { label: "Niedrig", className: "bg-surface-sunken text-text-secondary border-border-subtle", icon: <Activity className="h-3.5 w-3.5" /> },
};

const TRIGGER_LABELS: Record<string, string> = {
  high_risk: "Hohes Risiko",
  inactive_days: "Inaktivität",
  low_readiness: "Niedrige Reife",
  score_drop: "Score-Abfall",
  exam_fail_pattern: "Prüfungsfehler",
  not_started: "Nicht gestartet",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Offen",
  sent: "Gesendet",
  acknowledged: "Gesehen",
  resolved: "Gelöst",
  dismissed: "Verworfen",
};

function formatDate(d?: string | null) {
  if (!d) return "–";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(d));
}

export default function OrgInterventionPanel({ organizationId }: Props) {
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [selectedIntervention, setSelectedIntervention] = useState<OrgIntervention | null>(null);

  const { data: summary, isLoading: loadingSummary } = useOrgInterventionSummary(organizationId);
  const { data: interventions = [], isLoading: loadingList } = useOrgInterventions(
    organizationId,
    statusFilter === "all" ? undefined : statusFilter,
    severityFilter === "all" ? undefined : severityFilter
  );
  const scanMutation = useScanOrgInterventions();
  const resolveMutation = useResolveIntervention();

  const handleScan = () => {
    scanMutation.mutate({ orgId: organizationId }, {
      onSuccess: (data) => {
        toast.success(`Scan abgeschlossen: ${data.interventions_created} neue Interventionen`);
      },
      onError: () => toast.error("Scan fehlgeschlagen"),
    });
  };

  const handleResolve = (id: string, action: string) => {
    resolveMutation.mutate({ interventionId: id, action }, {
      onSuccess: () => {
        toast.success(action === "resolved" ? "Als gelöst markiert" : action === "dismissed" ? "Verworfen" : "Bestätigt");
        setSelectedIntervention(null);
      },
    });
  };

  if (loadingSummary || loadingList) {
    return (
      <div data-density="comfortable" className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-petrol-600" />
      </div>
    );
  }

  const criticalHigh = (summary?.critical_count ?? 0) + (summary?.high_count ?? 0);

  return (
    <div data-density="comfortable" className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          icon={<BellRing className="h-4 w-4 text-warning" />}
          label="Offene Fälle"
          value={summary?.total_open ?? 0}
          highlight={(summary?.total_open ?? 0) > 0}
        />
        <KpiCard
          icon={<ShieldAlert className="h-4 w-4 text-danger" />}
          label="Kritisch / Hoch"
          value={criticalHigh}
          highlight={criticalHigh > 0}
        />
        <KpiCard
          icon={<Activity className="h-4 w-4 text-petrol-600 dark:text-mint-400" />}
          label="Heute neu"
          value={summary?.created_today ?? 0}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4 text-success" />}
          label="Diese Woche gelöst"
          value={summary?.resolved_this_week ?? 0}
        />
      </div>

      {/* Actions + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              <SelectItem value="open">Offen</SelectItem>
              <SelectItem value="acknowledged">Gesehen</SelectItem>
              <SelectItem value="resolved">Gelöst</SelectItem>
              <SelectItem value="dismissed">Verworfen</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Schweregrade</SelectItem>
              <SelectItem value="critical">Kritisch</SelectItem>
              <SelectItem value="high">Hoch</SelectItem>
              <SelectItem value="medium">Mittel</SelectItem>
              <SelectItem value="low">Niedrig</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleScan} disabled={scanMutation.isPending} variant="outline" size="sm">
          <RefreshCw className={cn("h-4 w-4 mr-2", scanMutation.isPending && "animate-spin")} />
          Scan starten
        </Button>
      </div>

      {/* Intervention Table */}
      <Card variant="raised">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-display text-text-primary">Interventionen</CardTitle>
          <CardDescription className="text-text-secondary tabular-nums">{interventions.length} Einträge</CardDescription>
        </CardHeader>
        <CardContent>
          {interventions.length === 0 ? (
            <div className="py-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-bg-subtle">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
              <p className="text-sm text-text-secondary">
                Keine Interventionen gefunden.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border-subtle">
                  <TableHead className="text-text-tertiary font-medium">Schwere</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Lernender</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Auslöser</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Titel</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Status</TableHead>
                  <TableHead className="text-text-tertiary font-medium">Erstellt</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {interventions.map((row) => (
                  <InterventionRow
                    key={row.id}
                    row={row}
                    onSelect={() => setSelectedIntervention(row)}
                    onResolve={handleResolve}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail Drawer */}
      <Sheet open={!!selectedIntervention} onOpenChange={(o) => !o && setSelectedIntervention(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {selectedIntervention && (
            <InterventionDetail
              intervention={selectedIntervention}
              onResolve={handleResolve}
              isPending={resolveMutation.isPending}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function InterventionRow({ row, onSelect, onResolve }: { row: OrgIntervention; onSelect: () => void; onResolve: (id: string, action: string) => void }) {
  const sev = SEVERITY_CONFIG[row.severity] ?? SEVERITY_CONFIG.low;
  return (
    <TableRow className="cursor-pointer border-border-subtle hover:bg-surface-hover/50 transition-colors" onClick={onSelect}>
      <TableCell>
        <Badge variant="outline" className={cn("text-xs gap-1 font-medium", sev.className)}>
          {sev.icon}{sev.label}
        </Badge>
      </TableCell>
      <TableCell className="font-medium text-sm text-text-primary">{row.display_name}</TableCell>
      <TableCell className="text-sm text-text-secondary">{TRIGGER_LABELS[row.trigger_type] ?? row.trigger_type}</TableCell>
      <TableCell className="text-sm text-text-primary max-w-[240px] truncate">{row.title}</TableCell>
      <TableCell>
        <Badge variant="secondary" className="text-xs">{STATUS_LABELS[row.status] ?? row.status}</Badge>
      </TableCell>
      <TableCell className="text-sm text-text-tertiary tabular-nums">{formatDate(row.created_at)}</TableCell>
      <TableCell>
        {row.status === "open" && (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-text-tertiary hover:text-text-primary" onClick={() => onResolve(row.id, "acknowledged")} title="Gesehen">
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-success hover:text-success hover:bg-success-bg-subtle" onClick={() => onResolve(row.id, "resolved")} title="Lösen">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-text-tertiary hover:text-danger hover:bg-danger-bg-subtle" onClick={() => onResolve(row.id, "dismissed")} title="Verwerfen">
              <XCircle className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function InterventionDetail({ intervention, onResolve, isPending }: { intervention: OrgIntervention; onResolve: (id: string, action: string) => void; isPending: boolean }) {
  const sev = SEVERITY_CONFIG[intervention.severity] ?? SEVERITY_CONFIG.low;
  const rec = intervention.recommendation_json as Record<string, unknown>;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-start gap-2 text-text-primary font-display">
          <Badge variant="outline" className={cn("text-xs gap-1 mt-0.5 shrink-0 font-medium", sev.className)}>{sev.icon}{sev.label}</Badge>
          <span>{intervention.title}</span>
        </SheetTitle>
        <SheetDescription className="text-text-secondary">
          <span className="font-medium text-text-primary">{intervention.display_name}</span>
          <span className="text-text-quaternary mx-1.5">·</span>
          {intervention.product_title ?? "–"}
        </SheetDescription>
      </SheetHeader>
      <div className="mt-6 space-y-5">
        <div>
          <h4 className="text-xs uppercase tracking-wide font-medium text-text-tertiary mb-1.5">Beschreibung</h4>
          <p className="text-sm text-text-secondary leading-relaxed">{intervention.message}</p>
        </div>

        <div>
          <h4 className="text-xs uppercase tracking-wide font-medium text-text-tertiary mb-1.5">Auslöser</h4>
          <Badge variant="secondary">{TRIGGER_LABELS[intervention.trigger_type] ?? intervention.trigger_type}</Badge>
        </div>

        {!!rec?.recommendation_type && (
          <div>
            <h4 className="text-xs uppercase tracking-wide font-medium text-text-tertiary mb-1.5">Empfehlung</h4>
            <p className="text-sm text-text-secondary leading-relaxed">{String((rec as Record<string, unknown>).reason ?? "–")}</p>
          </div>
        )}

        <div>
          <h4 className="text-xs uppercase tracking-wide font-medium text-text-tertiary mb-1.5">Kontext</h4>
          <pre className="text-xs bg-surface-sunken border border-border-subtle text-text-secondary p-3 rounded-lg overflow-x-auto font-mono">
            {JSON.stringify(intervention.context_json, null, 2)}
          </pre>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary tabular-nums pt-2 border-t border-border-subtle">
          <span>Erstellt: {formatDate(intervention.created_at)}</span>
          {intervention.resolved_at && <span className="text-text-quaternary">· Gelöst: {formatDate(intervention.resolved_at)}</span>}
        </div>

        {intervention.status === "open" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => onResolve(intervention.id, "acknowledged")}>
              <Eye className="h-4 w-4 mr-1.5" />Gesehen
            </Button>
            <Button size="sm" variant="petrol" disabled={isPending} onClick={() => onResolve(intervention.id, "resolved")}>
              <CheckCircle2 className="h-4 w-4 mr-1.5" />Lösen
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => onResolve(intervention.id, "dismissed")} className="text-text-tertiary hover:text-danger hover:bg-danger-bg-subtle">
              <XCircle className="h-4 w-4 mr-1.5" />Verwerfen
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function KpiCard({ icon, label, value, highlight, onClick }: { icon?: React.ReactNode; label: string; value: number; highlight?: boolean; onClick?: () => void }) {
  return (
    <Card
      variant={onClick ? "interactive" : "raised"}
      className={cn("hover:shadow-elev-2 transition-shadow duration-base", onClick && "cursor-pointer")}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5 text-text-secondary font-medium">
          {icon}{label}
        </CardDescription>
        <CardTitle className={cn("text-3xl font-display tabular-nums", highlight ? "text-danger" : "text-text-primary")}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
