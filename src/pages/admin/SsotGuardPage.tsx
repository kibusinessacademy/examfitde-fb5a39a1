import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, Clock } from "lucide-react";

type Row = {
  domain: string;
  enabled: boolean;
  enforce_mode: string;
  description: string | null;
  violations_7d: number;
  overrides_7d: number;
  last_violation_at: string | null;
};

type Violation = {
  id: string;
  domain: string;
  kind: string;
  object_name: string | null;
  actor_role: string | null;
  detail: any;
  blocked: boolean;
  created_at: string;
};

export default function SsotGuardPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [loading, setLoading] = useState(true);
  const [override, setOverride] = useState({ domain: "", reason: "", ttl: 15 });

  async function load() {
    setLoading(true);
    const [statusRes, vRes] = await Promise.all([
      (supabase as any).from("v_admin_ssot_guard_status").select("*"),
      (supabase as any)
        .from("ssot_guard_violations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (statusRes.error) toast.error(statusRes.error.message);
    else setRows(statusRes.data ?? []);
    if (!vRes.error) setViolations(vRes.data ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function toggle(domain: string, enabled: boolean, mode: string) {
    const { error } = await (supabase as any).rpc("admin_ssot_guard_toggle", {
      _domain: domain,
      _enabled: enabled,
      _mode: mode,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(`Guard ${domain}: ${enabled ? mode : "off"}`);
      load();
    }
  }

  async function grantOverride() {
    if (!override.domain || override.reason.trim().length < 10) {
      toast.error("Domain + Begründung (≥10 Zeichen) erforderlich");
      return;
    }
    const { data, error } = await (supabase as any).rpc("admin_ssot_override", {
      _domain: override.domain,
      _reason: override.reason,
      _ttl_minutes: override.ttl,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(`Override gewährt bis ${(data as any)?.expires_at}`);
      setOverride({ domain: "", reason: "", ttl: 15 });
      load();
    }
  }

  return (
    <div className="container py-6 space-y-6">
      <header className="flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">SSOT Guardrails</h1>
          <p className="text-sm text-muted-foreground">
            Unverletzbare technische Schranken — DB-Hard-Fail, Audit-Pflicht, zeitlich begrenzter Override.
          </p>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {rows.map((r) => (
          <Card key={r.domain}>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{r.domain}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
              </div>
              <Badge variant={r.enabled && r.enforce_mode === "block" ? "default" : "secondary"}>
                {r.enabled ? r.enforce_mode : "off"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>Enabled (block mode)</span>
                <Switch
                  checked={r.enabled && r.enforce_mode === "block"}
                  onCheckedChange={(v) => toggle(r.domain, v, v ? "block" : "off")}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-muted p-2">
                  <div className="text-muted-foreground">Verstöße 7d</div>
                  <div className="text-lg font-semibold">{r.violations_7d}</div>
                </div>
                <div className="rounded bg-muted p-2">
                  <div className="text-muted-foreground">Overrides 7d</div>
                  <div className="text-lg font-semibold">{r.overrides_7d}</div>
                </div>
              </div>
              {r.last_violation_at && (
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> letzter Verstoß: {new Date(r.last_violation_at).toLocaleString()}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Override gewähren (Audit-Pflicht)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_2fr_120px_auto]">
          <Input
            placeholder="domain"
            value={override.domain}
            onChange={(e) => setOverride({ ...override, domain: e.target.value })}
          />
          <Textarea
            placeholder="Begründung (≥10 Zeichen)"
            value={override.reason}
            rows={1}
            onChange={(e) => setOverride({ ...override, reason: e.target.value })}
          />
          <Input
            type="number"
            min={1}
            max={120}
            value={override.ttl}
            onChange={(e) => setOverride({ ...override, ttl: Number(e.target.value) })}
          />
          <Button onClick={grantOverride}>Gewähren</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Letzte 50 Ereignisse</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="py-1 pr-2">Zeit</th>
                  <th className="py-1 pr-2">Domain</th>
                  <th className="py-1 pr-2">Art</th>
                  <th className="py-1 pr-2">Objekt</th>
                  <th className="py-1 pr-2">Blocked</th>
                  <th className="py-1 pr-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {violations.map((v) => (
                  <tr key={v.id} className="border-t">
                    <td className="py-1 pr-2 whitespace-nowrap">{new Date(v.created_at).toLocaleString()}</td>
                    <td className="py-1 pr-2">{v.domain}</td>
                    <td className="py-1 pr-2">
                      <Badge variant={v.kind === "violation" ? "destructive" : "secondary"}>{v.kind}</Badge>
                    </td>
                    <td className="py-1 pr-2 font-mono">{v.object_name ?? "—"}</td>
                    <td className="py-1 pr-2">{v.blocked ? "yes" : "no"}</td>
                    <td className="py-1 pr-2 font-mono text-[10px]">{JSON.stringify(v.detail)}</td>
                  </tr>
                ))}
                {!loading && violations.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-muted-foreground">
                      Keine Ereignisse.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
