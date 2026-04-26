import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Loader2, RefreshCcw, Search, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { AdminPageHeader } from "@/components/admin/v2/AdminPageHeader";

interface AuditRow {
  id: string;
  route_key: string;
  route_path: string | null;
  model: string;
  latency_ms: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
  user_id: string | null;
  user_email: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
}

function fmtMs(v: number | null) {
  if (v == null) return "—";
  if (v < 1000) return `${v} ms`;
  return `${(v / 1000).toFixed(2)} s`;
}

export default function AIAnalysisAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-ai-page-analysis", {
      body: { action: "audit", limit: 300 },
    });
    if (!error && data?.audit) setRows(data.audit as AuditRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.route_key, r.route_path, r.model, r.user_email, r.status]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [rows, filter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const errors = rows.filter((r) => r.status === "error").length;
    const validLatencies = rows.map((r) => r.latency_ms).filter((v): v is number => typeof v === "number");
    const avg = validLatencies.length
      ? Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length)
      : 0;
    const p95 = (() => {
      if (!validLatencies.length) return 0;
      const sorted = [...validLatencies].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
    })();
    const uniqueUsers = new Set(rows.map((r) => r.user_id).filter(Boolean)).size;
    const uniqueRoutes = new Set(rows.map((r) => r.route_key)).size;
    return { total, errors, avg, p95, uniqueUsers, uniqueRoutes };
  }, [rows]);

  return (
    <div className="space-y-4">
      <Helmet>
        <title>KI-Analyse Audit-Log · Admin</title>
      </Helmet>
      <AdminPageHeader
        title="KI-Analyse · Audit-Log"
        subtitle="Wer hat wann welche Seitenanalyse ausgelöst? Inklusive Latenz und Token-Verbrauch."
        icon={Activity}
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Gesamt</div><div className="text-xl font-semibold">{stats.total}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Fehler</div><div className="text-xl font-semibold text-destructive">{stats.errors}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Ø Latenz</div><div className="text-xl font-semibold">{fmtMs(stats.avg)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">p95 Latenz</div><div className="text-xl font-semibold">{fmtMs(stats.p95)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Admins aktiv</div><div className="text-xl font-semibold">{stats.uniqueUsers}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Routen</div><div className="text-xl font-semibold">{stats.uniqueRoutes}</div></Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter: route_key, user, model, status…"
            className="pl-8"
          />
        </div>
        <Button onClick={load} variant="outline" size="sm" disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
          Neu laden
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Wann</th>
                <th className="px-3 py-2 text-left">User</th>
                <th className="px-3 py-2 text-left">route_key</th>
                <th className="px-3 py-2 text-left">Model</th>
                <th className="px-3 py-2 text-right">Latenz</th>
                <th className="px-3 py-2 text-right">Tokens (in/out)</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Lade…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Keine Einträge.</td></tr>
              )}
              {!loading && filtered.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">
                    {new Date(r.created_at).toLocaleString("de-DE")}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.user_email ?? <span className="text-muted-foreground">{r.user_id?.slice(0, 8) ?? "—"}</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.route_key}</td>
                  <td className="px-3 py-2 text-xs">{r.model}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMs(r.latency_ms)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    {r.tokens_in ?? "—"} / {r.tokens_out ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.status === "success" ? (
                      <Badge variant="outline" className="text-[10px]">success</Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[10px]" title={r.error_message ?? ""}>error</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
