/**
 * /admin/observatory — Stripe Webhook Observatory
 * --------------------------------------------------------------
 * Live view of received Stripe webhook events (status, type, payload).
 * Admin-only via admin_get_stripe_event_log RPC (has_role gate).
 *
 * Features:
 *  - Summary KPIs (24h/7d, by status, by type, recent errors)
 *  - Filterable table (event_type, status)
 *  - Payload-View Modal
 *  - "Test-Event auslösen" button → admin-stripe-webhook-test edge fn
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Send, AlertTriangle, CheckCircle2, Clock, Eye } from "lucide-react";
import { format } from "date-fns";

interface EventRow {
  id: string;
  stripe_event_id: string;
  event_type: string;
  livemode: boolean;
  process_status: "received" | "ok" | "error" | "skipped";
  error_message: string | null;
  handler_duration_ms: number | null;
  received_at: string;
  processed_at: string | null;
  payload: any;
  handler_notes: any;
}

interface Summary {
  total: number;
  last_24h: number;
  last_7d: number;
  errors_24h: number;
  by_status: Record<string, number>;
  by_type: Array<{ event_type: string; count: number; errors: number }>;
  recent_errors: Array<{ stripe_event_id: string; event_type: string; error_message: string; received_at: string }>;
}

const TEST_EVENTS = [
  { value: "checkout.session.completed", label: "checkout.session.completed" },
  { value: "checkout.session.expired", label: "checkout.session.expired" },
  { value: "payment_intent.payment_failed", label: "payment_intent.payment_failed" },
  { value: "charge.refunded", label: "charge.refunded" },
  { value: "unknown.event.type", label: "unknown.event.type (Smoke)" },
];


function StatusBadge({ status }: { status: EventRow["process_status"] }) {
  if (status === "ok") return <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="h-3 w-3 mr-1" />ok</Badge>;
  if (status === "error") return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />error</Badge>;
  if (status === "skipped") return <Badge variant="secondary">skipped</Badge>;
  return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />received</Badge>;
}

export default function StripeObservatoryPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [testEventType, setTestEventType] = useState("checkout.session.expired");
  const [triggering, setTriggering] = useState(false);
  const [lastTestResult, setLastTestResult] = useState<any>(null);

  async function load() {
    setLoading(true);
    try {
      const [{ data: evts, error: evtErr }, { data: sum }] = await Promise.all([
        supabase.rpc("admin_get_stripe_event_log" as any, {
          _limit: 200,
          _event_type_filter: typeFilter === "all" ? null : typeFilter,
          _status_filter: statusFilter === "all" ? null : statusFilter,
        }),
        supabase.rpc("admin_get_stripe_event_log_summary" as any),
      ]);
      if (evtErr) throw evtErr;
      setEvents((evts as EventRow[]) || []);
      setSummary((sum as Summary) || null);
    } catch (err: any) {
      toast({ title: "Fehler beim Laden", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [typeFilter, statusFilter]);

  async function triggerTest() {
    setTriggering(true);
    setLastTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-stripe-webhook-test", {
        body: { event_type: testEventType },
      });
      if (error) throw error;
      setLastTestResult(data);
      toast({
        title: data.ok ? `✅ Test-Event gesendet — ${data.status} OK` : `⚠️ Webhook antwortete ${data.status}`,
        description: `${data.event_type} · ${data.duration_ms}ms · ${data.stripe_event_id}`,
        variant: data.ok ? "default" : "destructive",
      });
      setTimeout(load, 800);
    } catch (err: any) {
      toast({ title: "Trigger fehlgeschlagen", description: err.message, variant: "destructive" });
      setLastTestResult({ error: err.message });
    } finally {
      setTriggering(false);
    }
  }

  const eventTypes = useMemo(() => {
    const set = new Set(events.map((e) => e.event_type));
    return Array.from(set).sort();
  }, [events]);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-7xl">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stripe Webhook Observatory</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live-Übersicht aller Webhook-Events vom Stripe-Account. Zeigt Status, Fehlerdetails und Payloads.
          </p>
        </div>
        <Button onClick={load} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Aktualisieren
        </Button>
      </header>

      {/* Alert banner: errors in last 24h */}
      {summary && summary.errors_24h > 0 && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold text-destructive">
              {summary.errors_24h} Webhook-Fehler in den letzten 24 Stunden
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Filtere unten nach Status „error", um die Ursachen zu sehen.
            </div>
          </div>
        </div>
      )}

      {/* Summary KPIs */}
      {summary && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Total</div>
              <div className="text-2xl font-semibold">{summary.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Letzte 24h</div>
              <div className="text-2xl font-semibold">{summary.last_24h}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">7 Tage — OK</div>
              <div className="text-2xl font-semibold text-emerald-600">{summary.by_status?.ok ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">24h — Fehler</div>
              <div className={`text-2xl font-semibold ${summary.errors_24h > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                {summary.errors_24h ?? 0}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Test-Trigger */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="h-4 w-4" /> Test-Event auslösen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sendet ein synthetisches, korrekt signiertes Event an den Live-Webhook.
            Ergebnis erscheint hier und in der Tabelle unten.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={testEventType} onValueChange={setTestEventType}>
              <SelectTrigger className="w-[280px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TEST_EVENTS.map((e) => (
                  <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={triggerTest} disabled={triggering}>
              {triggering ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Senden
            </Button>
          </div>
          {lastTestResult && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(lastTestResult, null, 2)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[280px]"><SelectValue placeholder="Event-Typ" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Typen</SelectItem>
            {eventTypes.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            <SelectItem value="ok">ok</SelectItem>
            <SelectItem value="error">error</SelectItem>
            <SelectItem value="received">received</SelectItem>
            <SelectItem value="skipped">skipped</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Events table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Empfangene Events ({events.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Event-Typ</th>
                  <th className="text-left p-3">Empfangen</th>
                  <th className="text-left p-3">Mode</th>
                  <th className="text-left p-3">Fehler</th>
                  <th className="text-left p-3">Stripe Event ID</th>
                  <th className="text-right p-3">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Lädt…
                  </td></tr>
                )}
                {!loading && events.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">
                    Noch keine Events empfangen.
                  </td></tr>
                )}
                {events.map((e) => (
                  <tr key={e.id} className="border-t hover:bg-muted/20">
                    <td className="p-3"><StatusBadge status={e.process_status} /></td>
                    <td className="p-3 font-mono text-xs">{e.event_type}</td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {format(new Date(e.received_at), "yyyy-MM-dd HH:mm:ss")}
                    </td>
                    <td className="p-3">
                      <Badge variant={e.livemode ? "default" : "outline"} className="text-xs">
                        {e.livemode ? "live" : "test"}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-destructive max-w-[300px] truncate">
                      {e.error_message || "—"}
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground truncate max-w-[180px]">
                      {e.stripe_event_id}
                    </td>
                    <td className="p-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedEvent(e)}>
                        <Eye className="h-3 w-3 mr-1" /> Payload
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Payload modal */}
      <Dialog open={!!selectedEvent} onOpenChange={(o) => !o && setSelectedEvent(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {selectedEvent?.event_type} · {selectedEvent?.stripe_event_id}
            </DialogTitle>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap text-xs">
                <StatusBadge status={selectedEvent.process_status} />
                <Badge variant="outline">{selectedEvent.livemode ? "live" : "test"}</Badge>
                <span className="text-muted-foreground">
                  Empfangen: {format(new Date(selectedEvent.received_at), "yyyy-MM-dd HH:mm:ss")}
                </span>
                {selectedEvent.processed_at && (
                  <span className="text-muted-foreground">
                    Verarbeitet: {format(new Date(selectedEvent.processed_at), "HH:mm:ss")}
                  </span>
                )}
              </div>
              {selectedEvent.error_message && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  <div className="font-semibold mb-1">Fehlermeldung</div>
                  {selectedEvent.error_message}
                </div>
              )}
              <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-[50vh]">
                {JSON.stringify(selectedEvent.payload, null, 2)}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
