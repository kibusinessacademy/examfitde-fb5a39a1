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
  critical: { label: "Kritisch", className: "bg-destructive/15 text-destructive border-destructive/30", icon: <ShieldAlert className="h-3.5 w-3.5" /> },
  high:     { label: "Hoch", className: "bg-destructive/10 text-destructive border-destructive/20", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  medium:   { label: "Mittel", className: "bg-warning/15 text-warning border-warning/30", icon: <BellRing className="h-3.5 w-3.5" /> },
  low:      { label: "Niedrig", className: "bg-muted text-muted-foreground border-border", icon: <Activity className="h-3.5 w-3.5" /> },
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
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Offene Fälle" value={summary?.total_open ?? 0} highlight={(summary?.total_open ?? 0) > 0} />
        <KpiCard label="Kritisch / Hoch" value={(summary?.critical_count ?? 0) + (summary?.high_count ?? 0)} highlight={(summary?.critical_count ?? 0) + (summary?.high_count ?? 0) > 0} />
        <KpiCard label="Heute neu" value={summary?.created_today ?? 0} />
        <KpiCard label="Diese Woche gelöst" value={summary?.resolved_this_week ?? 0} />
      </div>

      {/* Actions + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
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
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Interventionen</CardTitle>
          <CardDescription>{interventions.length} Einträge</CardDescription>
        </CardHeader>
        <CardContent>
          {interventions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Keine Interventionen gefunden.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Schwere</TableHead>
                  <TableHead>Lernender</TableHead>
                  <TableHead>Auslöser</TableHead>
                  <TableHead>Titel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Erstellt</TableHead>
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
    <TableRow className="cursor-pointer" onClick={onSelect}>
      <TableCell>
        <Badge variant="outline" className={cn("text-xs gap-1", sev.className)}>
          {sev.icon}{sev.label}
        </Badge>
      </TableCell>
      <TableCell className="font-medium text-sm">{row.display_name}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{TRIGGER_LABELS[row.trigger_type] ?? row.trigger_type}</TableCell>
      <TableCell className="text-sm max-w-[240px] truncate">{row.title}</TableCell>
      <TableCell>
        <Badge variant="secondary" className="text-xs">{STATUS_LABELS[row.status] ?? row.status}</Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{formatDate(row.created_at)}</TableCell>
      <TableCell>
        {row.status === "open" && (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onResolve(row.id, "acknowledged")} title="Gesehen">
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-success" onClick={() => onResolve(row.id, "resolved")} title="Lösen">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={() => onResolve(row.id, "dismissed")} title="Verwerfen">
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
        <SheetTitle className="flex items-center gap-2">
          <Badge variant="outline" className={cn("text-xs gap-1", sev.className)}>{sev.icon}{sev.label}</Badge>
          {intervention.title}
        </SheetTitle>
        <SheetDescription>{intervention.display_name} · {intervention.product_title ?? "–"}</SheetDescription>
      </SheetHeader>
      <div className="mt-6 space-y-6">
        <div>
          <h4 className="text-sm font-medium mb-1">Beschreibung</h4>
          <p className="text-sm text-muted-foreground">{intervention.message}</p>
        </div>

        <div>
          <h4 className="text-sm font-medium mb-1">Auslöser</h4>
          <Badge variant="secondary">{TRIGGER_LABELS[intervention.trigger_type] ?? intervention.trigger_type}</Badge>
        </div>

        {!!rec?.recommendation_type && (
          <div>
            <h4 className="text-sm font-medium mb-1">Empfehlung</h4>
            <p className="text-sm text-muted-foreground">{String((rec as Record<string, unknown>).reason ?? "–")}</p>
          </div>
        )}

        <div>
          <h4 className="text-sm font-medium mb-1">Kontext</h4>
          <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto">
            {JSON.stringify(intervention.context_json, null, 2)}
          </pre>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Erstellt: {formatDate(intervention.created_at)}</span>
          {intervention.resolved_at && <span>· Gelöst: {formatDate(intervention.resolved_at)}</span>}
        </div>

        {intervention.status === "open" && (
          <div className="flex gap-2 pt-2">
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => onResolve(intervention.id, "acknowledged")}>
              <Eye className="h-4 w-4 mr-1.5" />Gesehen
            </Button>
            <Button size="sm" disabled={isPending} onClick={() => onResolve(intervention.id, "resolved")}>
              <CheckCircle2 className="h-4 w-4 mr-1.5" />Lösen
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => onResolve(intervention.id, "dismissed")}>
              <XCircle className="h-4 w-4 mr-1.5" />Verwerfen
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function KpiCard({ label, value, highlight, onClick }: { label: string; value: number; highlight?: boolean; onClick?: () => void }) {
  return (
    <Card
      className={cn(
        "transition-all",
        onClick && "cursor-pointer hover:ring-2 hover:ring-primary/30 active:scale-[0.98]"
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn("text-3xl", highlight && "text-destructive")}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
