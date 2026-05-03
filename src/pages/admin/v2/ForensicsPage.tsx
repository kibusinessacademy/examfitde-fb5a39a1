/**
 * Forensics Dashboard — /admin/forensics
 *
 * Drei Karten:
 *  1. Completed Jobs pro Kurs (letzte 2h) — Tabelle
 *  2. Live-Pipeline-Status — Lane-Counts + Reverter-Loop-Fix-Indikator
 *  3. Audit-Log (auto_heal_log) — Filter + Suche, default letzte 2h
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, Search, RefreshCw, AlertTriangle, CheckCircle2, Clock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const REFRESH_MS = 30_000;

// ─── Card 1: completed jobs per course (last 2h) ────────────────────────────
function useCompletedJobsByCourse() {
  return useQuery({
    queryKey: ["forensics", "completed-2h"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("job_queue")
        .select("package_id, completed_at, job_type")
        .eq("status", "completed")
        .gte("completed_at", since)
        .not("package_id", "is", null)
        .limit(5000);
      if (error) throw error;

      const byPkg = new Map<string, { count: number; last: string; types: Set<string> }>();
      for (const r of (data ?? []) as Array<{ package_id: string; completed_at: string; job_type: string }>) {
        const cur = byPkg.get(r.package_id) ?? { count: 0, last: r.completed_at, types: new Set() };
        cur.count += 1;
        if (r.completed_at > cur.last) cur.last = r.completed_at;
        cur.types.add(r.job_type);
        byPkg.set(r.package_id, cur);
      }

      const ids = [...byPkg.keys()];
      let titles = new Map<string, string>();
      if (ids.length > 0) {
        const { data: pkgs } = await supabase
          .from("course_packages")
          .select("id, title")
          .in("id", ids);
        titles = new Map((pkgs ?? []).map((p: any) => [p.id, p.title]));
      }
      return [...byPkg.entries()]
        .map(([package_id, v]) => ({
          package_id,
          title: titles.get(package_id) ?? "(unbekannt)",
          completed: v.count,
          last_completed: v.last,
          job_types: [...v.types].sort(),
        }))
        .sort((a, b) => b.completed - a.completed);
    },
  });
}

function CompletedByCourseCard() {
  const { data, isLoading, refetch, isFetching } = useCompletedJobsByCourse();
  const total = data?.reduce((s, r) => s + r.completed, 0) ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Completed Jobs / Kurs · letzte 2h
          </CardTitle>
          <p className="text-xs text-text-tertiary mt-1">
            {total} Jobs über {data?.length ?? 0} Kurse
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-9" />)}</div>
        ) : !data?.length ? (
          <p className="text-sm text-text-tertiary py-6 text-center">
            Keine completed Jobs in den letzten 2 Stunden.
          </p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Kurs</TableHead>
                  <TableHead className="text-xs text-right">Jobs</TableHead>
                  <TableHead className="text-xs hidden md:table-cell">Letzter Abschluss</TableHead>
                  <TableHead className="text-xs hidden lg:table-cell">Job-Typen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map(r => (
                  <TableRow key={r.package_id}>
                    <TableCell className="py-2 text-sm font-medium">{r.title}</TableCell>
                    <TableCell className="py-2 text-right">
                      <Badge variant="outline" className="font-mono">{r.completed}</Badge>
                    </TableCell>
                    <TableCell className="py-2 text-xs text-text-tertiary hidden md:table-cell whitespace-nowrap">
                      {new Date(r.last_completed).toLocaleString("de-DE")}
                    </TableCell>
                    <TableCell className="py-2 text-[10px] text-text-tertiary hidden lg:table-cell">
                      {r.job_types.slice(0, 4).join(", ")}{r.job_types.length > 4 ? "…" : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Card 2: Live Pipeline Status ───────────────────────────────────────────
function useLiveStatus() {
  return useQuery({
    queryKey: ["forensics", "live-status"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const since30 = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const since6h = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

      const [jobsRes, revertRes, cooldownRes, completed6hRes] = await Promise.all([
        supabase.from("job_queue").select("status").in("status", ["pending", "queued", "processing", "running", "failed"]).limit(2000),
        supabase.from("auto_heal_log").select("id", { count: "exact", head: true })
          .eq("action_type", "pending_enqueue_revert_trace").gte("created_at", since30),
        supabase.from("auto_heal_log").select("id", { count: "exact", head: true })
          .eq("action_type", "orphan_queued_dedup_cooldown").gte("created_at", since30),
        supabase.from("job_queue").select("id", { count: "exact", head: true })
          .eq("status", "completed").gte("completed_at", since6h),
      ]);

      const jobs = (jobsRes.data ?? []) as Array<{ status: string }>;
      const counts = jobs.reduce((acc: Record<string, number>, j) => {
        acc[j.status] = (acc[j.status] ?? 0) + 1;
        return acc;
      }, {});

      const reverts30 = revertRes.count ?? 0;
      const cooldowns30 = cooldownRes.count ?? 0;
      // Indikator: Fix wirkt, wenn cooldowns > reverts (Heal-No-Revert greift)
      const fixActive = cooldowns30 > 0 && reverts30 < cooldowns30 * 2;

      return {
        counts,
        reverts30,
        cooldowns30,
        fixActive,
        completed6h: completed6hRes.count ?? 0,
      };
    },
  });
}

function LiveStatusCard() {
  const { data, isLoading } = useLiveStatus();
  const tile = (label: string, value: number | string, tone: "neutral" | "green" | "amber" | "red" = "neutral") => {
    const toneCls = {
      neutral: "border-border bg-surface",
      green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
      amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
      red: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    }[tone];
    return (
      <div className={`rounded-lg border p-3 ${toneCls}`}>
        <p className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</p>
        <p className="text-xl font-mono font-semibold mt-1">{value}</p>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Live-Pipeline-Status
          <Badge variant="outline" className="text-[10px] ml-auto">live · 30s</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              {tile("Pending", data.counts.pending ?? 0, (data.counts.pending ?? 0) > 100 ? "amber" : "neutral")}
              {tile("Queued", data.counts.queued ?? 0)}
              {tile("Processing", (data.counts.processing ?? 0) + (data.counts.running ?? 0),
                ((data.counts.processing ?? 0) + (data.counts.running ?? 0)) > 0 ? "green" : "amber")}
              {tile("Failed", data.counts.failed ?? 0, (data.counts.failed ?? 0) > 0 ? "red" : "neutral")}
            </div>

            <div className={`rounded-lg border p-3 ${data.fixActive ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10"}`}>
              <div className="flex items-center gap-2 mb-2">
                {data.fixActive ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                )}
                <p className="text-sm font-medium">
                  Reverter-Loop-Fix: {data.fixActive ? "aktiv" : "Beobachtung"}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-text-tertiary">Reverts (30m):</span>{" "}
                  <span className="font-mono">{data.reverts30}</span>
                </div>
                <div>
                  <span className="text-text-tertiary">Cooldowns (30m):</span>{" "}
                  <span className="font-mono">{data.cooldowns30}</span>
                </div>
                <div>
                  <span className="text-text-tertiary">Completed (6h):</span>{" "}
                  <span className="font-mono">{data.completed6h}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Card 3: Audit Log Filter ───────────────────────────────────────────────
type LogRow = {
  id: string;
  created_at: string;
  action_type: string;
  trigger_source: string | null;
  result_status: string | null;
  target_id: string | null;
  target_type: string | null;
  error_message: string | null;
};

function useAuditLog(hours: number) {
  return useQuery({
    queryKey: ["forensics", "audit-log", hours],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("auto_heal_log")
        .select("id,created_at,action_type,trigger_source,result_status,target_id,target_type,error_message")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as LogRow[];
    },
  });
}

function AuditLogCard() {
  const [hours, setHours] = useState(2);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const { data, isLoading } = useAuditLog(hours);

  const actions = useMemo(
    () => [...new Set((data ?? []).map(r => r.action_type))].sort(),
    [data],
  );
  const statuses = useMemo(
    () => [...new Set((data ?? []).map(r => r.result_status).filter(Boolean) as string[])].sort(),
    [data],
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter(r => {
      if (actionFilter !== "all" && r.action_type !== actionFilter) return false;
      if (statusFilter !== "all" && r.result_status !== statusFilter) return false;
      if (q) {
        const hay = `${r.action_type} ${r.trigger_source ?? ""} ${r.target_id ?? ""} ${r.error_message ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, search, actionFilter, statusFilter]);

  const statusTone = (s: string | null) => {
    if (!s) return "outline";
    if (["ok", "success", "completed"].includes(s)) return "default";
    if (["failed", "error"].includes(s)) return "destructive";
    return "secondary";
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          Audit-Log · auto_heal_log
          <Badge variant="outline" className="text-[10px] ml-auto">{filtered.length} / {data?.length ?? 0}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-text-tertiary" />
            <Input
              placeholder="Action / target_id / fehler suchen…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Select value={String(hours)} onValueChange={v => setHours(Number(v))}>
            <SelectTrigger className="w-[120px] h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">letzte 1h</SelectItem>
              <SelectItem value="2">letzte 2h</SelectItem>
              <SelectItem value="6">letzte 6h</SelectItem>
              <SelectItem value="24">letzte 24h</SelectItem>
            </SelectContent>
          </Select>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[200px] h-9 text-xs"><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Actions</SelectItem>
              {actions.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-8" />)}</div>
        ) : !filtered.length ? (
          <p className="text-sm text-text-tertiary py-6 text-center">Keine Events im Filter.</p>
        ) : (
          <div className="border rounded-lg overflow-hidden max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-surface z-10">
                <TableRow>
                  <TableHead className="text-xs">Zeit</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                  <TableHead className="text-xs hidden md:table-cell">Trigger</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs hidden lg:table-cell">Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 200).map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="py-1.5 text-[11px] text-text-tertiary whitespace-nowrap font-mono">
                      {new Date(r.created_at).toLocaleTimeString("de-DE")}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Badge variant="outline" className="text-[10px] font-mono">{r.action_type}</Badge>
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-text-tertiary hidden md:table-cell">
                      {r.trigger_source ?? "–"}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Badge variant={statusTone(r.result_status) as any} className="text-[10px]">
                        {r.result_status ?? "–"}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-1.5 text-[10px] font-mono text-text-tertiary hidden lg:table-cell">
                      {r.target_type ? `${r.target_type}:` : ""}{r.target_id?.slice(0, 8) ?? "–"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ForensicsPage() {
  return (
    <div className="space-y-5">
      <Helmet><title>Forensics · Admin</title></Helmet>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Forensics</h1>
        <p className="text-sm text-text-tertiary">
          Live-Pipeline + Kurs-Throughput + Audit-Log in einer Ansicht.
        </p>
      </div>
      <LiveStatusCard />
      <CompletedByCourseCard />
      <AuditLogCard />
    </div>
  );
}
