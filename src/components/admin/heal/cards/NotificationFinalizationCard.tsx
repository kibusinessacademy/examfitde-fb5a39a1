import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Power, Beaker, Search, RefreshCw, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Kill = { paused: boolean; reason: string | null; actor_uid: string | null; updated_at: string };
type Smoke = { stage: string; passed: boolean; detail: any };

export default function NotificationFinalizationCard() {
  const [kill, setKill] = useState<Kill | null>(null);
  const [reason, setReason] = useState("");
  const [smoke, setSmoke] = useState<Smoke[]>([]);
  const [jobId, setJobId] = useState("");
  const [explain, setExplain] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const loadKill = async () => {
    const { data } = await (supabase as any).rpc("admin_get_notification_kill_switch");
    setKill(data as Kill);
  };
  useEffect(() => { loadKill(); }, []);

  const toggleKill = async (paused: boolean) => {
    if (!reason || reason.trim().length < 4) {
      toast.error("Begründung (min. 4 Zeichen) ist Pflicht.");
      return;
    }
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_set_notification_kill_switch", {
      p_paused: paused, p_reason: reason,
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setKill(data as Kill);
    setReason("");
    toast.success(paused ? "Notifications global pausiert" : "Notifications wieder aktiv");
  };

  const runSmoke = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_smoke_notification_e2e");
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setSmoke((data ?? []) as Smoke[]);
  };

  const runExplain = async () => {
    if (!jobId) return;
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_explain_notification_decision", { p_job_id: jobId });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setExplain(data);
  };

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Notification Finalization
          <Badge variant="outline" className="ml-2 text-xs">Track 2.F</Badge>
          {kill?.paused && <Badge variant="destructive" className="ml-1 text-xs">PAUSED</Badge>}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Globaler Kill-Switch, E2E-Smoke und Drilldown „Warum wurde diese Notification (nicht) gesendet?"
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Kill-Switch */}
        <section className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <Power className={`h-4 w-4 ${kill?.paused ? "text-destructive" : "text-foreground"}`} />
            <span className="text-sm font-medium text-foreground">Global Kill-Switch</span>
            <Badge variant={kill?.paused ? "destructive" : "default"} className="text-xs">
              {kill?.paused ? "PAUSED" : "ACTIVE"}
            </Badge>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={loadKill}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
          {kill && (
            <p className="text-xs text-muted-foreground">
              Letzte Änderung: {new Date(kill.updated_at).toLocaleString("de-DE")} · Grund: {kill.reason ?? "—"}
            </p>
          )}
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Begründung (Pflicht, min. 4 Zeichen) — wird auditiert."
            className="text-xs"
            rows={2}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => toggleKill(true)} disabled={loading || kill?.paused}>
              Pause All
            </Button>
            <Button size="sm" variant="default" onClick={() => toggleKill(false)} disabled={loading || !kill?.paused}>
              Resume
            </Button>
            <p className="text-xs text-muted-foreground self-center">
              Critical Intents (z.B. exam_countdown, payment_reminder) bleiben aktiv.
            </p>
          </div>
        </section>

        {/* E2E Smoke */}
        <section className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <Beaker className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">End-to-End Smoke</span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={runSmoke} disabled={loading}>
              Run
            </Button>
          </div>
          {smoke.length > 0 && (
            <div className="space-y-1">
              {smoke.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Badge variant={s.passed ? "default" : "destructive"} className="text-[10px]">
                    {s.passed ? "PASS" : "FAIL"}
                  </Badge>
                  <span className="text-foreground">{s.stage}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Drilldown */}
        <section className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Drilldown: Warum?</span>
          </div>
          <div className="flex gap-2">
            <Input
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              placeholder="notification_jobs.id (UUID)"
              className="text-xs"
            />
            <Button size="sm" variant="outline" onClick={runExplain} disabled={loading || !jobId}>
              Erklären
            </Button>
          </div>
          {explain && (
            <pre className="max-h-72 overflow-auto rounded-md bg-surface-subtle p-2 text-[10px] text-foreground">
              {JSON.stringify(explain, null, 2)}
            </pre>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
