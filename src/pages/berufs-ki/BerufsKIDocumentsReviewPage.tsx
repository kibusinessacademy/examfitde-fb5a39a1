/**
 * Berufs-KI Dokumenten-Agent — Phase 3: Review & Approval UI.
 * 3-Spalten: Pending-Liste · Dokument-Vorschau · Review-Panel.
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  listReviews, getReviewDetail, submitReviewDecision, addReviewComment,
  type ReviewListRow, type ReviewDetail, type ReviewStatus, type ReviewSeverity,
} from "@/lib/document-agent/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, CheckCircle2, XCircle, MessageSquare, ShieldAlert,
  FileText, Loader2, RefreshCcw, ClipboardCheck,
} from "lucide-react";

const RISK_BADGE: Record<string, string> = {
  low: "bg-status-bg-subtle-success text-status-fg-success",
  medium: "bg-status-bg-subtle-warning text-status-fg-warning",
  high: "bg-status-bg-subtle-danger text-status-fg-danger",
};
const STATUS_BADGE: Record<ReviewStatus, string> = {
  pending: "bg-status-bg-subtle-info text-status-fg-info",
  needs_changes: "bg-status-bg-subtle-warning text-status-fg-warning",
  approved: "bg-status-bg-subtle-success text-status-fg-success",
  rejected: "bg-status-bg-subtle-danger text-status-fg-danger",
  cancelled: "bg-surface-muted text-fg-muted",
};
const SEV_BADGE: Record<ReviewSeverity, string> = {
  info: "bg-status-bg-subtle-info text-status-fg-info",
  warning: "bg-status-bg-subtle-warning text-status-fg-warning",
  critical: "bg-status-bg-subtle-danger text-status-fg-danger",
};

type Filter = "pending" | "needs_changes" | "approved" | "rejected" | "all";

export default function BerufsKIDocumentsReviewPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>("pending");
  const [rows, setRows] = useState<ReviewListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentSeverity, setCommentSeverity] = useState<ReviewSeverity>("info");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listReviews(filter === "all" ? undefined : filter, 100);
      setRows(data);
      if (!selectedId && data.length > 0) setSelectedId(data[0].review_id);
    } catch (e) {
      toast({ title: "Konnte Reviews nicht laden", description: (e as Error).message, variant: "destructive" });
    } finally { setLoading(false); }
  }, [filter, selectedId, toast]);

  useEffect(() => { reload(); }, [reload]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true); setDecisionNotes(""); setCommentText("");
    try { setDetail(await getReviewDetail(id)); }
    catch (e) { toast({ title: "Detail-Fehler", description: (e as Error).message, variant: "destructive" }); }
    finally { setDetailLoading(false); }
  }, [toast]);

  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId, loadDetail]);

  const counts = useMemo(() => {
    const c = { pending: 0, needs_changes: 0, approved: 0, rejected: 0, high_risk: 0 };
    rows.forEach((r) => {
      if (r.status in c) (c as Record<string, number>)[r.status]++;
      if (r.risk_level === "high") c.high_risk++;
    });
    return c;
  }, [rows]);

  const decide = async (decision: "approved" | "rejected" | "needs_changes") => {
    if (!detail) return;
    setBusy(true);
    try {
      await submitReviewDecision(detail.review.id, decision, decisionNotes || undefined);
      toast({ title: `Entscheidung: ${decision}`, description: "Status wurde aktualisiert." });
      await reload(); await loadDetail(detail.review.id);
    } catch (e) {
      toast({ title: "Entscheidung fehlgeschlagen", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const postComment = async () => {
    if (!detail || !commentText.trim()) return;
    setBusy(true);
    try {
      await addReviewComment(detail.review.id, commentText.trim(), { severity: commentSeverity });
      setCommentText("");
      await loadDetail(detail.review.id); await reload();
    } catch (e) {
      toast({ title: "Kommentar fehlgeschlagen", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const readOnly = detail?.review.status === "approved" || detail?.review.status === "rejected" || detail?.review.status === "cancelled";

  return (
    <div className="container max-w-screen-2xl mx-auto p-4 space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="size-6" /> Dokumente — Review & Freigabe
          </h1>
          <p className="text-fg-muted text-sm mt-1">
            Enterprise-Freigabeprozess für KI-generierte Dokumente. High-Risk-Dokumente
            erfordern eine Freigabe, bevor sie exportiert werden können.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCcw className={`size-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Neu laden
        </Button>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Pending", v: counts.pending, cls: STATUS_BADGE.pending },
          { label: "Needs Changes", v: counts.needs_changes, cls: STATUS_BADGE.needs_changes },
          { label: "Approved", v: counts.approved, cls: STATUS_BADGE.approved },
          { label: "Rejected", v: counts.rejected, cls: STATUS_BADGE.rejected },
          { label: "High Risk", v: counts.high_risk, cls: RISK_BADGE.high },
        ].map((k) => (
          <Card key={k.label}><CardContent className="p-3">
            <div className="text-xs text-fg-muted">{k.label}</div>
            <div className={`text-2xl font-semibold mt-1 inline-block px-2 rounded ${k.cls}`}>{k.v}</div>
          </CardContent></Card>
        ))}
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="needs_changes">Needs Changes</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">Alle</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: list */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2"><CardTitle className="text-base">Reviews ({rows.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[70vh]">
              <div className="divide-y">
                {rows.length === 0 && !loading && (
                  <div className="p-4 text-sm text-fg-muted">Keine Reviews in dieser Ansicht.</div>
                )}
                {rows.map((r) => (
                  <button
                    key={r.review_id}
                    onClick={() => setSelectedId(r.review_id)}
                    className={`block w-full text-left p-3 hover:bg-surface-muted transition ${selectedId === r.review_id ? "bg-surface-muted" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">{r.template_title}</span>
                      <Badge className={RISK_BADGE[r.risk_level]} variant="secondary">{r.risk_level}</Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge className={STATUS_BADGE[r.status]} variant="secondary">{r.status}</Badge>
                      <span className="text-xs text-fg-muted">{r.template_category}</span>
                      {r.comment_count > 0 && (
                        <span className="text-xs text-fg-muted inline-flex items-center gap-1">
                          <MessageSquare className="size-3" />{r.comment_count}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-fg-muted mt-1 line-clamp-2">{r.generated_excerpt}</p>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Middle: document preview */}
        <Card className="lg:col-span-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="size-4" />
              {detail?.template.title ?? "Dokument"}
            </CardTitle>
            {detail && (
              <CardDescription className="flex items-center gap-2 flex-wrap">
                <Badge className={RISK_BADGE[detail.review.risk_level]} variant="secondary">
                  Risiko: {detail.review.risk_level}
                </Badge>
                <Badge className={STATUS_BADGE[detail.review.status]} variant="secondary">
                  {detail.review.status}
                </Badge>
                <span className="text-xs text-fg-muted">
                  Quality {detail.run.quality_score ?? "–"}
                </span>
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {detailLoading && <div className="flex items-center gap-2 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" /> Lade Detail …</div>}
            {!detailLoading && !detail && <div className="text-sm text-fg-muted">Wähle einen Review aus der Liste.</div>}
            {detail && (
              <>
                {(detail.run.compliance_warnings as Array<{ code: string; message: string }> | null)?.length ? (
                  <div className="mb-3 p-3 rounded border border-status-fg-warning/40 bg-status-bg-subtle-warning">
                    <div className="flex items-center gap-2 text-status-fg-warning font-medium text-sm mb-1">
                      <AlertTriangle className="size-4" /> Compliance-Warnungen
                    </div>
                    <ul className="text-xs space-y-1">
                      {(detail.run.compliance_warnings as Array<{ code: string; message: string }>).map((w, i) => (
                        <li key={i}><span className="font-mono">{w.code}</span> — {w.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {detail.review.risk_level === "high" && detail.review.status !== "approved" && (
                  <div className="mb-3 p-3 rounded border border-status-fg-danger/40 bg-status-bg-subtle-danger">
                    <div className="flex items-center gap-2 text-status-fg-danger font-medium text-sm">
                      <ShieldAlert className="size-4" /> High-Risk — Export blockiert bis zur Freigabe.
                    </div>
                  </div>
                )}
                <ScrollArea className="h-[60vh] border rounded p-4 bg-surface-card">
                  <pre className="whitespace-pre-wrap text-sm font-sans">{detail.run.generated_document ?? "(leer)"}</pre>
                </ScrollArea>
              </>
            )}
          </CardContent>
        </Card>

        {/* Right: review panel */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2"><CardTitle className="text-base">Review-Panel</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!detail && <div className="text-sm text-fg-muted">Kein Review ausgewählt.</div>}
            {detail && (
              <>
                <div>
                  <label className="text-xs font-medium text-fg-muted">Entscheidung-Notiz</label>
                  <Textarea
                    rows={3}
                    placeholder="Optionaler Hinweis für den Anfragenden …"
                    value={decisionNotes}
                    onChange={(e) => setDecisionNotes(e.target.value)}
                    disabled={readOnly || busy}
                  />
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <Button
                    onClick={() => decide("approved")}
                    disabled={readOnly || busy}
                    className="bg-status-fg-success hover:bg-status-fg-success/90 text-white"
                  >
                    <CheckCircle2 className="size-4 mr-2" /> Freigeben
                  </Button>
                  <Button
                    onClick={() => decide("needs_changes")}
                    disabled={readOnly || busy}
                    variant="outline"
                  >
                    <AlertTriangle className="size-4 mr-2" /> Änderungen nötig
                  </Button>
                  <Button
                    onClick={() => decide("rejected")}
                    disabled={readOnly || busy}
                    variant="destructive"
                  >
                    <XCircle className="size-4 mr-2" /> Ablehnen
                  </Button>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <MessageSquare className="size-4" /> Kommentare ({detail.comments.length})
                  </div>
                  <ScrollArea className="h-48 border rounded p-2">
                    {detail.comments.length === 0 && (
                      <div className="text-xs text-fg-muted">Noch keine Kommentare.</div>
                    )}
                    {detail.comments.map((c) => (
                      <div key={c.id} className="mb-2 pb-2 border-b last:border-0">
                        <div className="flex items-center gap-2">
                          <Badge className={SEV_BADGE[c.severity]} variant="secondary">{c.severity}</Badge>
                          {c.section_key && <span className="text-xs text-fg-muted">@ {c.section_key}</span>}
                        </div>
                        <p className="text-xs mt-1">{c.comment}</p>
                        <div className="text-[10px] text-fg-muted mt-1">{new Date(c.created_at).toLocaleString()}</div>
                      </div>
                    ))}
                  </ScrollArea>
                  <Textarea
                    rows={2}
                    placeholder="Kommentar hinzufügen …"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    disabled={busy}
                  />
                  <div className="flex items-center gap-2">
                    <Select value={commentSeverity} onValueChange={(v) => setCommentSeverity(v as ReviewSeverity)}>
                      <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={postComment} disabled={!commentText.trim() || busy}>
                      Posten
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
