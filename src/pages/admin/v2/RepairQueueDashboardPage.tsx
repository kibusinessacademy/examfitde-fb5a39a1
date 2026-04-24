/**
 * RepairQueueDashboardPage
 * ────────────────────────
 * Per-Kurs/Track Sicht auf den Repair-Queue-Status:
 *   - Approved Questions / Competency-Coverage-Lücke / aktive Jobs
 *   - "Warum stalled?" Diagnose-Spalte (z. B. wrong_repair_route, no_repair_enqueued)
 *   - Aufklappbare Live-Job-Detail-Reihen mit job_type, mode, target_competency_count,
 *     auto_heal_origin, resolved_strategy — exakt die Felder aus dem Verify-Snippet im Brief.
 *
 * Reine Read-only Sicht. Keine Heal-Aktionen — dafür existiert das Heal-Cockpit.
 */
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Wrench,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Search,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import {
  getRepairQueueOverview,
  type RepairQueueRow,
  type StallReason,
} from "@/features/admin/api/repairQueueApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const POLL_MS = 30_000;

const STALL_VARIANT: Record<StallReason["kind"], { label: string; cls: string }> = {
  ok: { label: "OK", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" },
  running: { label: "Läuft", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30" },
  no_repair_enqueued: { label: "Kein Repair", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  wrong_repair_route: { label: "Falsches Repair", cls: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30" },
  hard_fail: { label: "HARD FAIL", cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" },
  exhausted: { label: "Erschöpft", cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" },
  no_progress: { label: "Kein Fortschritt", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  unknown: { label: "Unklar", cls: "bg-muted text-muted-foreground border-border" },
};

export default function RepairQueueDashboardPage() {
  const [trackFilter, setTrackFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [onlyStalled, setOnlyStalled] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["repair-queue-dashboard", trackFilter, onlyStalled, search],
    queryFn: () =>
      getRepairQueueOverview({
        trackOnly: trackFilter === "ALL" ? null : trackFilter,
        onlyStalled,
        search,
      }),
    refetchInterval: POLL_MS,
    staleTime: 15_000,
  });

  const rows = data ?? [];

  const tracks = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.track && s.add(r.track));
    return Array.from(s).sort();
  }, [rows]);

  const stats = useMemo(() => {
    const buckets: Record<StallReason["kind"], number> = {
      ok: 0,
      running: 0,
      no_repair_enqueued: 0,
      wrong_repair_route: 0,
      hard_fail: 0,
      exhausted: 0,
      no_progress: 0,
      unknown: 0,
    };
    rows.forEach((r) => {
      buckets[r.stall_reason.kind] += 1;
    });
    return buckets;
  }, [rows]);

  const toggleRow = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="container max-w-7xl py-6 space-y-6">
      <Helmet>
        <title>Repair-Queue Dashboard · ExamFit Admin</title>
      </Helmet>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Wrench className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Repair-Queue Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Pro Kurs/Track: Approved-Questions, Competency-Coverage, aktive Repair-Jobs — und warum ein Kurs stalled.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Aktualisieren
        </Button>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiBadge label="HARD FAIL" value={stats.hard_fail} variant="hard_fail" />
        <KpiBadge label="Erschöpft" value={stats.exhausted} variant="exhausted" />
        <KpiBadge label="Falsches Repair" value={stats.wrong_repair_route} variant="wrong_repair_route" />
        <KpiBadge label="Kein Repair" value={stats.no_repair_enqueued} variant="no_repair_enqueued" />
        <KpiBadge label="Kein Fortschritt" value={stats.no_progress} variant="no_progress" />
        <KpiBadge label="Läuft" value={stats.running} variant="running" />
        <KpiBadge label="OK" value={stats.ok} variant="ok" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filter</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground mb-1 block">Suche</label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Titel oder Package-ID …"
                className="pl-8"
              />
            </div>
          </div>
          <div className="min-w-[200px]">
            <label className="text-xs text-muted-foreground mb-1 block">Track</label>
            <Select value={trackFilter} onValueChange={setTrackFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Alle Tracks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Alle Tracks</SelectItem>
                {tracks.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch id="only-stalled" checked={onlyStalled} onCheckedChange={setOnlyStalled} />
            <label htmlFor="only-stalled" className="text-sm">
              Nur stalled
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Pakete ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Lade …
            </div>
          ) : error ? (
            <div className="px-6 py-8 text-sm text-destructive">
              Fehler beim Laden: {(error as Error).message}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
              Keine Pakete passen zum Filter — alle gesund.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Kurs</TableHead>
                    <TableHead>Track</TableHead>
                    <TableHead className="text-right">Approved</TableHead>
                    <TableHead className="text-right">Comp-Lücke</TableHead>
                    <TableHead className="text-right">LF-Lücke</TableHead>
                    <TableHead className="text-right">Jobs</TableHead>
                    <TableHead>Stall-Grund</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const isOpen = expanded.has(r.package_id);
                    return (
                      <RepairRow
                        key={r.package_id}
                        row={r}
                        open={isOpen}
                        onToggle={() => toggleRow(r.package_id)}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiBadge({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: StallReason["kind"];
}) {
  const v = STALL_VARIANT[variant];
  return (
    <div className={`rounded-lg border px-3 py-2 ${v.cls}`}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="text-2xl font-bold leading-tight">{value}</div>
    </div>
  );
}

function RepairRow({
  row,
  open,
  onToggle,
}: {
  row: RepairQueueRow;
  open: boolean;
  onToggle: () => void;
}) {
  const stall = STALL_VARIANT[row.stall_reason.kind];
  const totalJobs = row.active_repair_jobs + row.active_validate_jobs;
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/30" onClick={onToggle}>
        <TableCell className="py-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell>
          <div className="font-medium">{row.title}</div>
          <div className="text-xs text-muted-foreground font-mono">
            {row.package_id.slice(0, 8)} · {row.status} · {row.build_progress}%
          </div>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className="text-xs">
            {row.track ?? "—"}
          </Badge>
        </TableCell>
        <TableCell className="text-right tabular-nums">{row.approved_count}</TableCell>
        <TableCell className="text-right tabular-nums">
          {row.missing_competency_coverage > 0 ? (
            <span className="text-amber-600 dark:text-amber-400 font-semibold">
              {row.missing_competency_coverage}
            </span>
          ) : (
            <span className="text-muted-foreground">0</span>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {row.missing_lf_coverage > 0 ? (
            <span className="text-amber-600 dark:text-amber-400 font-semibold">
              {row.missing_lf_coverage}
            </span>
          ) : (
            <span className="text-muted-foreground">0</span>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          <span className="text-xs">
            {totalJobs}
            {totalJobs > 0 && (
              <span className="text-muted-foreground ml-1">
                (R{row.active_repair_jobs}/V{row.active_validate_jobs})
              </span>
            )}
          </span>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={`text-xs ${stall.cls}`}>
            {stall.label}
          </Badge>
          <div className="text-xs text-muted-foreground mt-0.5 max-w-md truncate">
            {row.stall_reason.label}
          </div>
        </TableCell>
        <TableCell>
          <Link
            to={`/admin/heal-cockpit/package/${row.package_id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" /> Diag
          </Link>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted/20">
          <TableCell />
          <TableCell colSpan={8} className="py-3">
            <RowDetail row={row} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function RowDetail({ row }: { row: RepairQueueRow }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <Detail label="current_step" value={row.current_step ?? "—"} mono />
        <Detail label="blocked_reason" value={row.blocked_reason ?? "—"} />
        <Detail label="guard_state" value={row.guard_state ?? "—"} />
        <Detail label="reason_code" value={row.reason_code ?? "—"} mono />
        <Detail label="recommended_action" value={row.recommended_action ?? "—"} />
        <Detail label="consecutive_no_progress" value={String(row.consecutive_no_progress)} />
        <Detail
          label="repair_attempts_24h"
          value={`${row.repair_attempts_24h} (validate ${row.validate_attempts_24h})`}
        />
        <Detail
          label="last_repair_at"
          value={row.last_repair_at ? new Date(row.last_repair_at).toLocaleString() : "—"}
        />
      </div>

      <div>
        <div className="text-xs font-semibold mb-1">Aktive Repair-Jobs ({row.live_repair_jobs.length})</div>
        {row.live_repair_jobs.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">Keine aktiven Repair-Jobs in Queue.</div>
        ) : (
          <div className="space-y-1">
            {row.live_repair_jobs.map((j) => (
              <div
                key={j.id}
                className="rounded border bg-background px-2 py-1.5 text-xs font-mono flex flex-wrap gap-x-4 gap-y-1"
              >
                <span className="font-semibold">{j.job_type}</span>
                <span>
                  status=<span className="text-primary">{j.status}</span>
                </span>
                {j.mode && (
                  <span>
                    mode=<span className="text-emerald-600 dark:text-emerald-400">{j.mode}</span>
                  </span>
                )}
                {j.target_competency_count > 0 && (
                  <span>
                    targets=<span className="text-emerald-600 dark:text-emerald-400">{j.target_competency_count}</span>
                  </span>
                )}
                {j.auto_heal_origin && <span>origin={j.auto_heal_origin}</span>}
                {j.resolved_strategy && <span>strategy={j.resolved_strategy}</span>}
                <span>attempts={j.attempts}</span>
                {j.last_error && (
                  <span className="text-destructive truncate max-w-md" title={j.last_error}>
                    err={j.last_error.slice(0, 80)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono" : ""}>{value}</div>
    </div>
  );
}
