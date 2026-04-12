import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Shield, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatDateTime } from "@/lib/timezone";
import { cn } from "@/lib/utils";

interface GuardrailEvent {
  id: number;
  created_at: string;
  guard_key: string;
  details: Record<string, unknown>;
}

interface ReadinessRow {
  package_id: string;
  title: string;
  status: string;
  lessons_total: number;
  lessons_real: number;
  lessons_placeholder: number;
  cv_approved: number;
  lessons_qc_approved: number;
  approved_questions: number;
}

const GUARD_LABELS: Record<string, { label: string; color: string }> = {
  done_implies_ok: { label: "Done ≠ OK", color: "text-destructive" },
  queued_meta_hygiene: { label: "Queued Stale Meta", color: "text-yellow-600" },
  building_done_without_started_at: { label: "Done w/o Start", color: "text-yellow-600" },
  hollow_published_auto_quarantine: { label: "Hollow → Quarantine", color: "text-destructive" },
  quarantine: { label: "Quarantine", color: "text-destructive" },
};

export default function GuardrailEventsPanel() {
  const [events, setEvents] = useState<GuardrailEvent[]>([]);
  const [readiness, setReadiness] = useState<ReadinessRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [evRes, rdRes] = await Promise.all([
      (supabase as any)
        .from("ops_guardrail_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      (supabase as any)
        .from("v_package_publish_readiness")
        .select("*")
        .in("status", ["published", "building", "quality_gate_failed", "publish_failed"])
        .order("title"),
    ]);
    setEvents(evRes.data ?? []);
    setReadiness(rdRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const readinessOk = (r: ReadinessRow) =>
    r.lessons_total > 0 &&
    r.lessons_real >= Math.ceil(r.lessons_total * 0.85) &&
    r.cv_approved > 0 &&
    r.lessons_qc_approved > 0;

  const hollowCount = readiness.filter((r) => r.status === "published" && !readinessOk(r)).length;
  const quarantineCount = events.filter((e) => e.guard_key === "quarantine" || e.guard_key === "hollow_published_auto_quarantine").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-base font-bold flex items-center gap-2">
          <Shield className="h-4.5 w-4.5 text-primary" />
          Guardrails & Publish Readiness
        </h3>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className={cn("p-3 border-l-4", hollowCount > 0 ? "border-l-destructive bg-destructive/5" : "border-l-emerald-500")}>
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Hollow Published
          </div>
          <div className={cn("text-2xl font-black", hollowCount > 0 ? "text-destructive" : "text-emerald-500")}>
            {hollowCount}
          </div>
        </Card>
        <Card className="p-3 border-l-4 border-l-primary">
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" /> Quarantine Events
          </div>
          <div className="text-2xl font-black">{quarantineCount}</div>
        </Card>
        <Card className={cn("p-3 border-l-4", events.length > 0 ? "border-l-yellow-500" : "border-l-emerald-500")}>
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" /> Total Events
          </div>
          <div className="text-2xl font-black">{events.length}</div>
        </Card>
      </div>

      {/* Publish Readiness Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold">Publish Readiness (active packages)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[320px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Paket</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Lessons</TableHead>
                  <TableHead className="text-xs">Real</TableHead>
                  <TableHead className="text-xs">Placeholder</TableHead>
                  <TableHead className="text-xs">CV Approved</TableHead>
                  <TableHead className="text-xs">QC Approved</TableHead>
                  <TableHead className="text-xs">Questions</TableHead>
                  <TableHead className="text-xs">Gate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {readiness.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-6">Keine aktiven Pakete.</TableCell>
                  </TableRow>
                ) : readiness.map((r) => {
                  const ok = readinessOk(r);
                  return (
                    <TableRow key={r.package_id}>
                      <TableCell className="text-xs font-medium max-w-[200px] truncate">{r.title}</TableCell>
                      <TableCell><Badge variant={r.status === "published" ? "default" : "secondary"} className="text-[10px]">{r.status}</Badge></TableCell>
                      <TableCell className="text-xs">{r.lessons_total}</TableCell>
                      <TableCell className="text-xs">{r.lessons_real}</TableCell>
                      <TableCell className="text-xs">{r.lessons_placeholder}</TableCell>
                      <TableCell className="text-xs">{r.cv_approved}</TableCell>
                      <TableCell className="text-xs">{r.lessons_qc_approved}</TableCell>
                      <TableCell className="text-xs">{r.approved_questions}</TableCell>
                      <TableCell>
                        <Badge variant={ok ? "default" : "destructive"} className="text-[10px]">
                          {ok ? "✅ PASS" : "❌ FAIL"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Guardrail Events Log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            Guardrail Events (letzte 50)
            <Badge variant="secondary" className="ml-auto text-xs">{events.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[360px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Zeitpunkt</TableHead>
                  <TableHead className="text-xs">Guard</TableHead>
                  <TableHead className="text-xs">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">Keine Events — alles sauber. ✅</TableCell>
                  </TableRow>
                ) : events.map((ev) => {
                  const meta = GUARD_LABELS[ev.guard_key] ?? { label: ev.guard_key, color: "text-muted-foreground" };
                  return (
                    <TableRow key={ev.id}>
                      <TableCell className="text-xs whitespace-nowrap">{formatDateTime(ev.created_at)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px]", meta.color)}>{meta.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-[400px]">
                        <div className="relative group">
                          <pre className="whitespace-pre-wrap break-all text-xs max-h-[120px] overflow-auto">
                            {(() => { const s = JSON.stringify(ev.details, null, 2); return s.length > 1200 ? s.slice(0, 1200) + "…" : s; })()}
                          </pre>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="absolute top-0 right-0 h-6 px-1.5 opacity-0 group-hover:opacity-100 text-[10px]"
                            onClick={() => navigator.clipboard.writeText(JSON.stringify(ev.details, null, 2))}
                          >
                            Copy
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
