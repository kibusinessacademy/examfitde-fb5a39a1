/**
 * Berufs-KI Phase 4C — Admin Review Center.
 * Pending Reviews · Governance Risks · Needs Changes · Top Community Ideas.
 */
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Loader2, Check, X, MessageSquare, GitMerge, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  adminListSubmissions,
  adminReviewSubmission,
  adminApproveSubmission,
  adminCommunityIntelligence,
  adminGetSubmission,
  type AdminSubmissionRow,
  type SubmissionStatus,
  type Submission,
} from "@/lib/berufs-ki/submissions";

const TAB_STATUS: Record<string, SubmissionStatus | undefined> = {
  pending: "pending_review",
  precheck: "pending_precheck",
  changes: "needs_changes",
  approved: "approved",
  rejected: "rejected",
  all: undefined,
};

export default function BerufsKIReviewPage() {
  const [tab, setTab] = useState<keyof typeof TAB_STATUS>("pending");
  const [rows, setRows] = useState<AdminSubmissionRow[] | null>(null);
  const [intel, setIntel] = useState<Awaited<ReturnType<typeof adminCommunityIntelligence>> | null>(null);
  const [active, setActive] = useState<Submission | null>(null);

  async function load() {
    setRows(null);
    const [data, intelData] = await Promise.all([
      adminListSubmissions(TAB_STATUS[tab]),
      adminCommunityIntelligence(30),
    ]);
    setRows(data);
    setIntel(intelData);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [tab]);

  return (
    <main className="space-y-6 p-4 md:p-6">
      <Helmet><title>Berufs-KI Review · Admin</title></Helmet>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Berufs-KI Review Center</h1>
        <p className="text-sm text-muted-foreground">Community-Einsendungen prüfen, freigeben, mergen, ablehnen.</p>
      </div>

      {intel && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <KpiCard label="Einsendungen 30T" value={intel.submissions_total} />
          <KpiCard label="Pending Review" value={intel.pending_review} accent="warning" />
          <KpiCard label="Needs Changes" value={intel.needs_changes} />
          <KpiCard label="Approved 30T" value={intel.approved} accent="success" />
          <KpiCard label="Ø Quality" value={intel.avg_quality ?? "—"} />
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as keyof typeof TAB_STATUS)}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="precheck">Precheck</TabsTrigger>
          <TabsTrigger value="changes">Needs Changes</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">Alle</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {!rows ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lade…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Einträge.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <Card key={r.id} className="hover:border-primary cursor-pointer" onClick={async () => setActive(await adminGetSubmission(r.id))}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-[10px]">{r.category}</Badge>
                          <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                          {r.beruf_slug && <Badge variant="outline" className="text-[10px]">🧰 {r.beruf_slug}</Badge>}
                          {r.merge_candidate_count > 0 && <Badge variant="outline" className="text-[10px]"><GitMerge className="h-3 w-3 mr-1" />{r.merge_candidate_count}</Badge>}
                        </div>
                        <h3 className="mt-1 font-medium leading-tight">{r.title}</h3>
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{r.goal}</p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground shrink-0">
                        <ScoreLine label="Dup" v={r.duplicate_score} invert />
                        <ScoreLine label="Gov" v={r.governance_score} />
                        <ScoreLine label="Qual" v={r.quality_score} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {active && <ReviewDrawer submission={active} onClose={() => setActive(null)} onUpdated={() => { setActive(null); void load(); }} />}
    </main>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: number | string; accent?: "success" | "warning" }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[11px] uppercase text-muted-foreground tracking-wide">{label}</div>
        <div className={`mt-1 text-2xl font-bold ${accent === "warning" ? "text-warning" : accent === "success" ? "text-success" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function ScoreLine({ label, v, invert }: { label: string; v: number | null; invert?: boolean }) {
  if (v === null || v === undefined) return <div className="text-[10px]">{label} —</div>;
  const good = invert ? v < 40 : v >= 60;
  return <div className={`text-[10px] ${good ? "text-success" : v >= 80 || (invert && v >= 60) ? "text-destructive" : ""}`}>{label} {Math.round(v)}</div>;
}

function ReviewDrawer({ submission, onClose, onUpdated }: { submission: Submission; onClose: () => void; onUpdated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [showApprove, setShowApprove] = useState(false);
  const [slug, setSlug] = useState(submission.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60));
  const [systemPrompt, setSystemPrompt] = useState(`Du bist eine Berufs-KI für ${submission.beruf_slug ?? "Fachkräfte"}. Liefere strukturiert nach den Output-Sektionen.`);
  const [userPrompt, setUserPrompt] = useState(submission.workflow_steps);

  const precheck = submission.precheck as Record<string, unknown> | null;

  async function act(action: "request_changes" | "reject" | "deprecate" | "merge") {
    setBusy(true);
    try {
      await adminReviewSubmission(submission.id, action, notes || undefined);
      toast.success("Aktion gespeichert.");
      onUpdated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }

  async function approve(withEdits: boolean) {
    setBusy(true);
    try {
      await adminApproveSubmission({
        submissionId: submission.id, slug, systemPrompt, userPromptTemplate: userPrompt, withEdits,
      });
      toast.success("Workflow veröffentlicht.");
      onUpdated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> {submission.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <Section label="Ziel">{submission.goal}</Section>
          <Section label="Workflow-Schritte"><pre className="whitespace-pre-wrap font-sans text-sm">{submission.workflow_steps}</pre></Section>
          <div className="grid grid-cols-2 gap-3">
            <Section label="Inputs">
              <ul className="list-disc pl-5">
                {submission.proposed_inputs.fields.map((f, i) => <li key={i}>{f.label}</li>)}
              </ul>
            </Section>
            <Section label="Output-Sektionen">
              <ul className="list-disc pl-5">
                {submission.proposed_outputs.sections.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </Section>
          </div>
          {submission.risks && <Section label="Risiken">{submission.risks}</Section>}
          {precheck && (
            <Section label="AI-Precheck">
              <pre className="whitespace-pre-wrap text-xs bg-muted p-2 rounded">{JSON.stringify(precheck, null, 2)}</pre>
            </Section>
          )}
        </div>

        {showApprove ? (
          <div className="space-y-2 border-t pt-4">
            <div className="text-sm font-medium">Veröffentlichen</div>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug" />
            <Textarea rows={3} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="System Prompt" />
            <Textarea rows={6} value={userPrompt} onChange={(e) => setUserPrompt(e.target.value)} placeholder="User Prompt Template (mit {{key}} Slots)" />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowApprove(false)} disabled={busy}>Zurück</Button>
              <Button onClick={() => approve(false)} disabled={busy}><Check className="h-4 w-4 mr-1" /> Approve</Button>
              <Button variant="default" onClick={() => approve(true)} disabled={busy}>Approve mit Edits</Button>
            </div>
          </div>
        ) : (
          <>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reviewer-Notiz (optional)" />
            <DialogFooter className="flex-wrap gap-2">
              <Button variant="ghost" onClick={onClose}>Schließen</Button>
              <Button variant="outline" onClick={() => act("merge")} disabled={busy}><GitMerge className="h-4 w-4 mr-1" /> Merge</Button>
              <Button variant="outline" onClick={() => act("request_changes")} disabled={busy}><MessageSquare className="h-4 w-4 mr-1" /> Changes</Button>
              <Button variant="destructive" onClick={() => act("reject")} disabled={busy}><X className="h-4 w-4 mr-1" /> Reject</Button>
              <Button onClick={() => setShowApprove(true)} disabled={busy}><Check className="h-4 w-4 mr-1" /> Approve…</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
