// FördermittelOS Cut 7 — Sales Inbox Lead Detail
import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Mail, Building2, Tag, Clock, ListChecks, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  ACTIVITY_LABEL,
  LEAD_ACTIVITY_KINDS,
  STATUS_LABEL,
  STATUS_TONE,
  classifyFollowup,
  computePriority,
  nextStatusOptions,
  validateActivityDraft,
  type LeadActivityKind,
  type LeadStatus,
  type SalesLeadActivity,
} from "@/lib/foerdermittel/salesInbox";

const STATUS_TONE_CLS: Record<string, string> = {
  primary: "border-primary/30 bg-primary/10 text-primary",
  warning: "border-warning-border bg-warning-bg-subtle text-warning",
  success: "border-success-border bg-success-bg-subtle text-success",
  destructive: "border-destructive-border bg-destructive-bg-subtle text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

interface LeadEvent {
  event_type: string;
  page_path: string | null;
  intent: string | null;
  created_at: string;
  metadata_public: Record<string, unknown> | null;
}

interface LeadDetail {
  lead: Record<string, any>;
  events: LeadEvent[];
}

export default function FoerdermittelLeadDetailPage() {
  const { leadId } = useParams<{ leadId: string }>();
  const { isAdmin, loading } = useAuth();
  const { toast } = useToast();
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [busy, setBusy] = useState(false);

  // activity form
  const [actKind, setActKind] = useState<LeadActivityKind>("note");
  const [actNote, setActNote] = useState("");
  const [actDue, setActDue] = useState<string>("");

  const reload = async () => {
    if (!leadId) return;
    setDetailLoading(true);
    const { data, error } = await (supabase.rpc as any)("admin_foerdermittel_lead_detail", { p_lead_id: leadId });
    if (error) { setError(error.message); setDetailLoading(false); return; }
    if ((data as any)?.error === "not_found") { setError("Lead nicht gefunden"); setDetailLoading(false); return; }
    setDetail(data as LeadDetail);
    setDetailLoading(false);
  };

  useEffect(() => { if (isAdmin) reload(); }, [isAdmin, leadId]);

  if (loading) return <main className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Laden …</main>;
  if (!isAdmin) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-md"><CardContent className="p-6 text-center space-y-2">
          <div className="font-semibold">Zugriff beschränkt</div>
          <Link to="/foerdermittel" className="text-sm text-primary hover:underline">Zurück</Link>
        </CardContent></Card>
      </main>
    );
  }

  const lead = detail?.lead;
  const status: LeadStatus | null = lead?.status ?? null;
  const meta = lead?.meta ?? {};
  const activities: SalesLeadActivity[] = Array.isArray(meta.activities) ? [...meta.activities].reverse() : [];

  const onSetStatus = async (to: LeadStatus) => {
    if (!leadId) return;
    if (statusReason.trim().length < 3) {
      toast({ title: "Begründung Pflicht", description: "Mind. 3 Zeichen.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { data, error } = await (supabase.rpc as any)("admin_foerdermittel_lead_set_status", {
      p_lead_id: leadId, p_new_status: to, p_reason: statusReason.trim(),
    });
    setBusy(false);
    if (error || !(data as any)?.ok) {
      toast({ title: "Statusänderung abgelehnt", description: (error?.message ?? (data as any)?.error) || "Unbekannt", variant: "destructive" });
      return;
    }
    toast({ title: "Status aktualisiert", description: `${(data as any).from} → ${(data as any).to}` });
    setStatusReason("");
    reload();
  };

  const onAddActivity = async () => {
    if (!leadId) return;
    const val = validateActivityDraft({ kind: actKind, note: actNote, nextActionAt: actDue || null });
    if (!val.ok) {
      toast({ title: "Aktivität ungültig", description: val.errors.join(", "), variant: "destructive" });
      return;
    }
    setBusy(true);
    const { data, error } = await (supabase.rpc as any)("admin_foerdermittel_lead_add_activity", {
      p_lead_id: leadId,
      p_kind: val.cleaned!.kind,
      p_note: val.cleaned!.note,
      p_next_action_at: val.cleaned!.nextActionAt,
    });
    setBusy(false);
    if (error || !(data as any)?.ok) {
      toast({ title: "Konnte nicht speichern", description: error?.message ?? "Fehler", variant: "destructive" });
      return;
    }
    setActNote(""); setActDue("");
    toast({ title: "Aktivität gespeichert" });
    reload();
  };

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>FördermittelOS Lead · intern</title>
        <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
      </Helmet>

      <section className="mx-auto max-w-5xl px-6 pt-8 pb-2">
        <Link to="/foerdermittel/inbox" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Sales Inbox
        </Link>
      </section>

      {detailLoading ? (
        <section className="mx-auto max-w-5xl px-6 py-12 text-sm text-muted-foreground">Lade Lead …</section>
      ) : error || !lead ? (
        <section className="mx-auto max-w-5xl px-6 py-12">
          <Card><CardContent className="p-6 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> {error ?? "Lead nicht verfügbar"}
          </CardContent></Card>
        </section>
      ) : (
        <>
          {/* Header */}
          <section className="mx-auto max-w-5xl px-6 pb-6">
            <Badge variant="outline" className="mb-2">intern · admin</Badge>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" /> {lead.company_name}
            </h1>
            <div className="mt-1 text-sm text-muted-foreground flex flex-wrap gap-4">
              <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {lead.contact_email}</span>
              {lead.industry && <span className="inline-flex items-center gap-1"><Tag className="h-3.5 w-3.5" /> {lead.industry}</span>}
              <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> erstellt {new Date(lead.created_at).toLocaleString("de-DE")}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {status && (
                <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${STATUS_TONE_CLS[STATUS_TONE[status]]}`}>
                  Status: {STATUS_LABEL[status]}
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] h-5 px-1.5">Quelle: {lead.source}</Badge>
              <Badge variant="outline" className="text-[10px] h-5 px-1.5">Tier: {meta.lead_tier ?? "cold"}</Badge>
              <Badge variant="outline" className="text-[10px] h-5 px-1.5 tabular-nums">Score: {meta.lead_quality_score ?? 0}</Badge>
              {lead.next_action_at && (
                <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                  Wiedervorlage: {new Date(lead.next_action_at).toLocaleDateString("de-DE")} ({classifyFollowup(lead.next_action_at)})
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                {PRIORITY(lead, status)}
              </Badge>
            </div>
          </section>

          {/* Status transition */}
          {status && nextStatusOptions(status).length > 0 && (
            <section className="mx-auto max-w-5xl px-6 pb-6">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h2 className="text-sm font-semibold">Status weiterführen (forward-only)</h2>
                  <Input
                    placeholder="Begründung (Pflicht, ≥3 Zeichen, keine PII)"
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                    maxLength={240}
                  />
                  <div className="flex flex-wrap gap-2">
                    {nextStatusOptions(status).map((s) => (
                      <Button key={s} size="sm" variant="outline" disabled={busy} onClick={() => onSetStatus(s)}>
                        → {STATUS_LABEL[s]}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {/* Report context */}
          <section className="mx-auto max-w-5xl px-6 pb-6 grid gap-3 sm:grid-cols-2">
            <Card><CardContent className="p-4">
              <h2 className="text-sm font-semibold mb-2 inline-flex items-center gap-2"><ListChecks className="h-4 w-4 text-primary" /> Report-Kontext</h2>
              <dl className="text-xs space-y-1">
                <Row k="Source Page" v={meta.source_page} />
                <Row k="Region" v={meta.region} />
                <Row k="Avg Fit" v={meta.report_avg_fit} />
                <Row k="Avg Probability" v={meta.report_avg_probability} />
                <Row k="Freshness Risks" v={meta.report_freshness_risks} />
                <Row k="Readiness" v={meta.report_readiness_verdict} />
                <Row k="Business Email" v={meta.is_business_email ? "ja" : "nein"} />
                <Row k="Consent at" v={meta.consent_at ? new Date(meta.consent_at).toLocaleString("de-DE") : null} />
              </dl>
              {Array.isArray(meta.report_top_slugs) && meta.report_top_slugs.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Top Programme</div>
                  <div className="flex flex-wrap gap-1">
                    {meta.report_top_slugs.map((s: string) => (
                      <Link key={s} to={`/foerdermittel/programm/${s}`} className="text-[10px] px-1.5 py-0.5 rounded border hover:bg-muted">
                        {s}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </CardContent></Card>

            <Card><CardContent className="p-4">
              <h2 className="text-sm font-semibold mb-2">Neue Aktivität</h2>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <select
                    value={actKind}
                    onChange={(e) => setActKind(e.target.value as LeadActivityKind)}
                    className="h-8 text-xs rounded-md border border-input bg-background px-2 flex-1"
                  >
                    {LEAD_ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{ACTIVITY_LABEL[k]}</option>)}
                  </select>
                  <Input
                    type="datetime-local"
                    value={actDue}
                    onChange={(e) => setActDue(e.target.value ? new Date(e.target.value).toISOString() : "")}
                    className="h-8 text-xs flex-1"
                  />
                </div>
                <Textarea
                  value={actNote}
                  onChange={(e) => setActNote(e.target.value)}
                  placeholder="Notiz (keine PII teilen — Audit speichert nur kind+lead_id)"
                  className="min-h-[80px] text-xs"
                  maxLength={2000}
                />
                <Button size="sm" disabled={busy} onClick={onAddActivity}>Speichern</Button>
              </div>
            </CardContent></Card>
          </section>

          {/* Activities timeline */}
          <section className="mx-auto max-w-5xl px-6 pb-6">
            <Card><CardContent className="p-4">
              <h2 className="text-sm font-semibold mb-3">Aktivitäten ({activities.length})</h2>
              {activities.length === 0 ? (
                <p className="text-xs text-muted-foreground">Noch keine Aktivitäten.</p>
              ) : (
                <ul className="divide-y">
                  {activities.map((a, i) => (
                    <li key={i} className="py-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{ACTIVITY_LABEL[a.kind] ?? a.kind}</span>
                        <span className="text-muted-foreground tabular-nums">{a.at ? new Date(a.at).toLocaleString("de-DE") : ""}</span>
                      </div>
                      <p className="text-foreground/90 mt-0.5 whitespace-pre-wrap">{a.note}</p>
                      {a.next_action_at && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Wiedervorlage: {new Date(a.next_action_at).toLocaleString("de-DE")}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent></Card>
          </section>

          {/* Event history */}
          <section className="mx-auto max-w-5xl px-6 pb-12">
            <Card><CardContent className="p-4">
              <h2 className="text-sm font-semibold mb-3">Event-Historie ({detail?.events.length ?? 0})</h2>
              {(detail?.events.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">Keine zugeordneten Events.</p>
              ) : (
                <ul className="divide-y">
                  {detail!.events.map((e, i) => (
                    <li key={i} className="py-1.5 text-xs flex items-center gap-3">
                      <span className="font-mono text-[10px] flex-1 truncate">{e.event_type}</span>
                      <span className="text-muted-foreground">{e.page_path ?? "—"}</span>
                      <span className="text-muted-foreground tabular-nums">{new Date(e.created_at).toLocaleString("de-DE")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent></Card>
          </section>
        </>
      )}
    </main>
  );
}

function Row({ k, v }: { k: string; v: unknown }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-mono text-foreground/90 truncate max-w-[60%] text-right">{v == null || v === "" ? "—" : String(v)}</dd>
    </div>
  );
}

function PRIORITY(lead: any, status: LeadStatus | null) {
  if (!status) return "—";
  const p = computePriority({
    status,
    tier: (lead.meta?.lead_tier ?? "cold") as any,
    score: Number(lead.meta?.lead_quality_score ?? 0),
    nextActionAt: lead.next_action_at,
    createdAt: lead.created_at,
  });
  return `Priorität ${p.toUpperCase()}`;
}
