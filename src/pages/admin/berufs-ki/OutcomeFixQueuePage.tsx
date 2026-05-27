/**
 * BerufAgentOS v2 — Cut 2.4 Controlled Recommendations Layer (HITL)
 *
 * Operations Review Center.
 * STRIKT KEIN AUTO-APPLY — Detection → Proposal → Review.
 */
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { AlertCircle, CheckCircle2, Loader2, ShieldAlert, XCircle, GitPullRequest } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  listFixProposals,
  getFixProposalsSummary,
  submitFixReview,
  withdrawFixProposal,
  type OutcomeFixProposal,
  type OutcomeFixReviewState,
  type OutcomeFixReviewDecision,
  type OutcomeFixSummary,
} from "@/lib/berufs-ki/outcome";

const STATE_LABEL: Record<OutcomeFixReviewState, string> = {
  draft: "Entwurf",
  in_review: "In Review",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  changes_requested: "Änderungen angefragt",
  withdrawn: "Zurückgezogen",
  expired: "Abgelaufen",
};

const SEVERITY_TONE: Record<string, string> = {
  critical: "bg-status-error-subtle text-status-error border-status-error/30",
  high: "bg-status-warn-subtle text-status-warn border-status-warn/30",
  medium: "bg-status-info-subtle text-status-info border-status-info/30",
  low: "bg-surface-muted text-text-secondary border-border-subtle",
  info: "bg-surface-muted text-text-tertiary border-border-subtle",
};

export default function OutcomeFixQueuePage() {
  const [summary, setSummary] = useState<OutcomeFixSummary | null>(null);
  const [proposals, setProposals] = useState<OutcomeFixProposal[]>([]);
  const [stateFilter, setStateFilter] = useState<OutcomeFixReviewState | "all">("in_review");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reviewTarget, setReviewTarget] = useState<OutcomeFixProposal | null>(null);
  const [reviewDecision, setReviewDecision] = useState<OutcomeFixReviewDecision>("approved");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewFollowup, setReviewFollowup] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, list] = await Promise.all([
        getFixProposalsSummary(),
        listFixProposals({ state: stateFilter === "all" ? null : stateFilter, limit: 200 }),
      ]);
      setSummary(s);
      setProposals(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [stateFilter]);

  const kpiTiles = useMemo(() => {
    if (!summary) return [];
    return [
      { label: "Offene Reviews", value: summary.in_review + summary.changes_requested, tone: "text-status-info" },
      { label: "Kritisch", value: summary.critical_open, tone: "text-status-error" },
      { label: "Hoch", value: summary.high_open, tone: "text-status-warn" },
      { label: "Freigegeben", value: summary.approved, tone: "text-status-success" },
      { label: "Ø Priorität", value: summary.avg_priority?.toFixed(2) ?? "—", tone: "text-text-primary" },
    ];
  }, [summary]);

  async function handleSubmit() {
    if (!reviewTarget) return;
    if (reviewReason.trim().length < 10) {
      toast({ title: "Begründung zu kurz", description: "Mindestens 10 Zeichen.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await submitFixReview(reviewTarget.id, reviewDecision, reviewReason.trim(), reviewFollowup.trim() || undefined);
      toast({ title: "Review eingetragen", description: `Vorschlag ${STATE_LABEL[reviewDecision as OutcomeFixReviewState] ?? reviewDecision}.` });
      setReviewTarget(null);
      setReviewReason("");
      setReviewFollowup("");
      await load();
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : "Unbekannt", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWithdraw(p: OutcomeFixProposal) {
    const reason = window.prompt("Grund für das Zurückziehen (min. 10 Zeichen):");
    if (!reason || reason.trim().length < 10) return;
    try {
      await withdrawFixProposal(p.id, reason.trim());
      toast({ title: "Zurückgezogen" });
      await load();
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : "Unbekannt", variant: "destructive" });
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <Helmet><title>Autonomous Fix Queue · BerufAgentOS</title></Helmet>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <GitPullRequest className="h-6 w-6 text-status-info" />
            Operations Review Center
          </h1>
          <p className="text-sm text-text-secondary mt-1 max-w-3xl">
            Reviewbare Fix-Vorschläge mit Ursache, Business-Wirkung, Risiko, Teststrategie und Rollback.
            <span className="text-status-warn"> HITL-only — keine Auto-Apply, keine Workflow-Mutationen.</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as OutcomeFixReviewState | "all")}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              {Object.entries(STATE_LABEL).map(([k, l]) => (
                <SelectItem key={k} value={k}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void load()}>Neu laden</Button>
        </div>
      </header>

      {kpiTiles.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {kpiTiles.map((t) => (
            <Card key={t.label}>
              <CardContent className="p-4">
                <div className="text-xs text-text-tertiary uppercase tracking-wide">{t.label}</div>
                <div className={`text-2xl font-semibold mt-1 ${t.tone}`}>{t.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-text-secondary">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Vorschläge werden geladen …
        </div>
      ) : error ? (
        <Card className="border-status-error/40">
          <CardContent className="p-6 flex items-start gap-3 text-status-error">
            <AlertCircle className="h-5 w-5 mt-0.5" />
            <div>
              <div className="font-medium">Fehler beim Laden</div>
              <div className="text-sm text-text-secondary mt-1">{error}</div>
            </div>
          </CardContent>
        </Card>
      ) : proposals.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-text-secondary">
            <ShieldAlert className="h-10 w-10 mx-auto mb-3 text-text-tertiary" />
            <div className="font-medium text-text-primary">Keine Fix-Vorschläge in diesem Status</div>
            <div className="text-sm mt-1">Detector-Layer erzeugt Vorschläge aus Cut-2.3-Findings, sobald Signale eintreffen.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {proposals.map((p) => (
            <Card key={p.id} className="border-border-subtle">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base text-text-primary">{p.title}</CardTitle>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Badge variant="outline" className={SEVERITY_TONE[p.severity] ?? ""}>{p.severity}</Badge>
                      <Badge variant="secondary">{p.proposal_type.replace(/_/g, " ")}</Badge>
                      <Badge variant="outline">{p.proposal_source.replace(/_/g, " ")}</Badge>
                      <Badge variant="outline">{p.vertical_key}</Badge>
                      <Badge variant="outline">{STATE_LABEL[p.review_state]}</Badge>
                      <Badge variant="outline">Priorität {p.priority_score.toFixed(2)}</Badge>
                    </div>
                  </div>
                  <div className="text-right text-xs text-text-tertiary">
                    <div>Confidence {(p.confidence_score * 100).toFixed(0)}%</div>
                    <div>Impact {(p.business_impact_score * 100).toFixed(0)}%</div>
                    <div>Risk {(p.risk_score * 100).toFixed(0)}%</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Section label="Problem">{p.proposal_summary}</Section>
                <Section label="Vorschlag">{p.suggested_fix}</Section>
                <Section label="Erwartete Wirkung">
                  {p.expected_outcome}
                  {(p.expected_kpi_delta_pct_min !== null || p.expected_kpi_delta_pct_max !== null) && (
                    <span className="ml-2 text-text-tertiary">
                      ({p.expected_kpi_delta_pct_min ?? "?"}–{p.expected_kpi_delta_pct_max ?? "?"} %)
                    </span>
                  )}
                </Section>
                <div className="grid md:grid-cols-3 gap-3">
                  <Section label="Risiko">{p.risk_summary}</Section>
                  <Section label="Teststrategie">{p.test_strategy}</Section>
                  <Section label="Rollback">{p.rollback_plan}</Section>
                </div>
                {p.business_intent_title && (
                  <div className="text-xs text-text-tertiary">
                    Business-Intent: <span className="text-text-secondary">{p.business_intent_title}</span>
                  </div>
                )}
                {p.finding_key && (
                  <div className="text-xs text-text-tertiary">
                    Quelle-Finding: <code className="text-text-secondary">{p.finding_key}</code>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2 border-t border-border-subtle">
                  {["in_review", "draft", "changes_requested"].includes(p.review_state) ? (
                    <>
                      <Button size="sm" variant="default" onClick={() => { setReviewTarget(p); setReviewDecision("approved"); }}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Freigeben
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setReviewTarget(p); setReviewDecision("changes_requested"); }}>
                        Änderungen anfordern
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => { setReviewTarget(p); setReviewDecision("rejected"); }}>
                        <XCircle className="h-4 w-4 mr-1" /> Ablehnen
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void handleWithdraw(p)}>Zurückziehen</Button>
                    </>
                  ) : (
                    <span className="text-xs text-text-tertiary">Finaler Status — keine weitere Aktion möglich.</span>
                  )}
                  {p.review_count > 0 && (
                    <span className="text-xs text-text-tertiary ml-auto self-center">{p.review_count} Review(s)</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!reviewTarget} onOpenChange={(o) => !o && setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review-Entscheidung</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-text-secondary">
              {reviewTarget?.title}
            </div>
            <Select value={reviewDecision} onValueChange={(v) => setReviewDecision(v as OutcomeFixReviewDecision)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">Freigeben</SelectItem>
                <SelectItem value="changes_requested">Änderungen anfordern</SelectItem>
                <SelectItem value="rejected">Ablehnen</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Begründung (min. 10 Zeichen) — wird auditiert."
              value={reviewReason}
              onChange={(e) => setReviewReason(e.target.value)}
              rows={3}
            />
            <Textarea
              placeholder="Empfohlenes Follow-up (optional)"
              value={reviewFollowup}
              onChange={(e) => setReviewFollowup(e.target.value)}
              rows={2}
            />
            <p className="text-xs text-text-tertiary">
              Freigabe erlaubt nur den Eintrag im Review-Ledger — es wird NICHTS automatisch angewendet.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewTarget(null)} disabled={submitting}>Abbrechen</Button>
            <Button onClick={() => void handleSubmit()} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Eintragen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className="text-sm text-text-primary mt-0.5 whitespace-pre-wrap">{children}</div>
    </div>
  );
}
