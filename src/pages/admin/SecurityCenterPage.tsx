import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, ShieldAlert, ShieldCheck, RefreshCw, Download, Lock, Unlock } from "lucide-react";

export default function SecurityCenterPage() {
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [reviews, setReviews] = useState<Record<string, unknown>[]>([]);
  const [locks, setLocks] = useState<Record<string, unknown>[]>([]);
  const [blocks, setBlocks] = useState<Record<string, unknown>[]>([]);
  const [spike, setSpike] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [e, r, l, b, s] = await Promise.all([
      supabase.from("security_events").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("security_reviews").select("*").eq("status", "open").order("updated_at", { ascending: false }).limit(100),
      supabase.from("license_code_lockouts").select("*").order("updated_at", { ascending: false }).limit(50),
      supabase.from("security_blocks").select("*").order("updated_at", { ascending: false }).limit(50),
      supabase.rpc("get_security_spike_score", { p_minutes: 60 }),
    ]);
    if (!e.error) setEvents((e.data ?? []) as Record<string, unknown>[]);
    if (!r.error) setReviews((r.data ?? []) as Record<string, unknown>[]);
    if (!l.error) setLocks((l.data ?? []) as Record<string, unknown>[]);
    if (!b.error) setBlocks((b.data ?? []) as Record<string, unknown>[]);
    if (!s.error) setSpike(s.data as Record<string, unknown>);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, status: "approved" | "blocked" | "dismissed") => {
    const until = status === "blocked" ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;
    await supabase.rpc("admin_decide_security_review", {
      p_review_id: id, p_status: status, p_note: `admin:${status}`, p_block_until: until,
    });
    await load();
  };

  const unblockUser = async (userId: string) => {
    await supabase.rpc("admin_unblock_user", { p_user_id: userId, p_reason: "admin_manual_unblock" });
    await load();
  };

  const resetCode = async (code: string) => {
    await supabase.rpc("admin_reset_code_lockout", { p_code: code, p_note: "admin_manual_reset" });
    await load();
  };

  const exportCsv = async () => {
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();
    const r = await supabase.rpc("get_security_report", { p_from: from, p_to: to, p_limit: 5000 });
    if (r.error || !r.data) return;

    const rows = r.data as Record<string, unknown>[];
    const headers = ["event_id", "event_type", "decision", "user_id", "license_code", "ip_hash", "device_hash", "reason", "created_at"];
    const csv = [headers.join(";"), ...rows.map((row) => headers.map((h) => String(row[h] ?? "")).join(";"))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `security_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const spikeScore = Number(spike?.score ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Shield className="h-5 w-5" /> Security Center
          </h2>
          <p className="text-sm text-muted-foreground">Reviews, Locks, Blocks, Bot-Detection & Audit</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={loading}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Spike Score */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Security Spike Score (60 min)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            {spikeScore >= 0.35 ? (
              <ShieldAlert className="h-8 w-8 text-destructive" />
            ) : (
              <ShieldCheck className="h-8 w-8 text-green-600" />
            )}
            <div>
              <span className="text-2xl font-bold">{(spikeScore * 100).toFixed(1)}%</span>
              <span className="ml-2 text-sm text-muted-foreground">
                ({Number(spike?.total ?? 0)} events, {Number(spike?.blocked ?? 0)} blocked, {Number(spike?.rate_limited ?? 0)} rate-limited)
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reviews */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Open Reviews ({reviews.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Score</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Reasons</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((r) => (
                <TableRow key={String(r.id)}>
                  <TableCell>
                    <Badge variant={Number(r.score ?? 0) >= 0.8 ? "destructive" : "secondary"}>
                      {Number(r.score ?? 0).toFixed(2)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{String(r.user_id ?? "").slice(0, 8)}…</TableCell>
                  <TableCell className="font-mono text-xs">{String(r.license_code ?? "—")}</TableCell>
                  <TableCell className="text-xs">{(r.reasons as string[] ?? []).join(", ")}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => decide(String(r.id), "approved")}>Approve</Button>
                      <Button size="sm" variant="destructive" onClick={() => decide(String(r.id), "blocked")}>Block 24h</Button>
                      <Button size="sm" variant="ghost" onClick={() => decide(String(r.id), "dismissed")}>Dismiss</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {reviews.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Keine offenen Reviews ✅</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Code Lockouts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1"><Lock className="h-4 w-4" /> Code Lockouts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {locks.slice(0, 15).map((l) => (
              <div key={String(l.license_code)} className="flex items-center justify-between border-b border-border py-1.5">
                <div>
                  <span className="font-mono text-xs">{String(l.license_code)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    fails: {Number(l.failed_attempts)} | until: {l.locked_until ? new Date(String(l.locked_until)).toLocaleString("de-DE") : "—"}
                  </span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => resetCode(String(l.license_code))}>
                  <Unlock className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {locks.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
          </CardContent>
        </Card>

        {/* User Blocks */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1"><ShieldAlert className="h-4 w-4" /> User Blocks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {blocks.slice(0, 15).map((b) => (
              <div key={String(b.user_id)} className="flex items-center justify-between border-b border-border py-1.5">
                <div>
                  <span className="font-mono text-xs">{String(b.user_id).slice(0, 8)}…</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {b.blocked_until ? new Date(String(b.blocked_until)).toLocaleString("de-DE") : "∞"} | {String(b.reason ?? "")}
                  </span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => unblockUser(String(b.user_id))}>
                  <Unlock className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {blocks.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
          </CardContent>
        </Card>
      </div>

      {/* Events */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Last Events ({events.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.slice(0, 100).map((e) => (
                  <TableRow key={String(e.id)}>
                    <TableCell className="text-xs">{new Date(String(e.created_at)).toLocaleString("de-DE")}</TableCell>
                    <TableCell className="text-xs">{String(e.event_type)}</TableCell>
                    <TableCell>
                      <Badge variant={e.decision === "block" ? "destructive" : e.decision === "review" ? "secondary" : "outline"}>
                        {String(e.decision)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{String(e.user_id ?? "").slice(0, 8)}…</TableCell>
                    <TableCell className="font-mono text-xs">{String(e.license_code ?? "—")}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{String(e.reason ?? "—")}</TableCell>
                  </TableRow>
                ))}
                {events.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">—</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
