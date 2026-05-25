/**
 * Berufs-KI Phase 5C — Submitter Inbox.
 * Eigene Submissions + Notifications (approved, merged, became_blueprint, …).
 */
import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Loader2, Inbox, FileText, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  learnerListMyNotifications,
  learnerListMySubmissions,
  learnerMarkNotificationRead,
  type SubmitterNotification,
  type MySubmissionRow,
} from "@/lib/berufs-ki/learning";
import { toast } from "sonner";

const EVENT_LABEL: Record<string, { label: string; tone: "default" | "secondary" | "outline" }> = {
  submission_received: { label: "Eingereicht", tone: "outline" },
  precheck_done: { label: "AI-Vorprüfung fertig", tone: "outline" },
  approved: { label: "Freigegeben", tone: "default" },
  approved_with_edits: { label: "Mit Anpassungen freigegeben", tone: "default" },
  needs_changes: { label: "Anpassungen nötig", tone: "secondary" },
  rejected: { label: "Nicht übernommen", tone: "secondary" },
  merged_into_official: { label: "In offiziellen Workflow gemerged", tone: "default" },
  became_blueprint_candidate: { label: "Blueprint-Kandidat", tone: "default" },
  blueprint_materialized: { label: "Offizieller Blueprint", tone: "default" },
};

export default function BerufsKIInboxPage() {
  const [notifs, setNotifs] = useState<SubmitterNotification[] | null>(null);
  const [subs, setSubs] = useState<MySubmissionRow[] | null>(null);

  const load = async () => {
    try {
      const [n, s] = await Promise.all([learnerListMyNotifications(), learnerListMySubmissions()]);
      setNotifs(n);
      setSubs(s);
    } catch (e) { toast.error((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);

  const onMarkRead = async (id: string) => {
    try {
      await learnerMarkNotificationRead(id);
      setNotifs((prev) => prev?.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n) ?? null);
    } catch (e) { toast.error((e as Error).message); }
  };

  const unread = notifs?.filter((n) => !n.read_at).length ?? 0;

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <Helmet><title>Mein Berufs-KI Beitrag</title></Helmet>

      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Mein Beitrag zur Berufs-KI</h1>
          {unread > 0 && <Badge>{unread} neu</Badge>}
        </div>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          Wenn dein Workflow Berufslogik verbessert, siehst du es hier. Beiträge können in offizielle Blueprints übergehen.
        </p>
      </header>

      <Tabs defaultValue="notifs">
        <TabsList>
          <TabsTrigger value="notifs" className="gap-2"><Inbox className="h-4 w-4" /> Updates ({notifs?.length ?? "…"})</TabsTrigger>
          <TabsTrigger value="subs" className="gap-2"><FileText className="h-4 w-4" /> Meine Submissions ({subs?.length ?? "…"})</TabsTrigger>
        </TabsList>

        <TabsContent value="notifs" className="mt-6 space-y-3">
          {notifs === null ? <Skel /> : notifs.length === 0 ? (
            <EmptyCta />
          ) : notifs.map((n) => {
            const meta = EVENT_LABEL[n.event_type] ?? { label: n.event_type, tone: "outline" as const };
            const isPositive = ["approved", "approved_with_edits", "merged_into_official", "became_blueprint_candidate", "blueprint_materialized"].includes(n.event_type);
            const isBlueprint = n.event_type === "became_blueprint_candidate" || n.event_type === "blueprint_materialized";
            return (
              <Card key={n.id} className={!n.read_at ? "border-primary/40" : undefined}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5 min-w-0">
                      <CardTitle className="text-base flex items-center gap-2">
                        {isBlueprint ? <Sparkles className="h-4 w-4 text-primary" /> :
                          isPositive ? <CheckCircle2 className="h-4 w-4 text-primary" /> :
                          <AlertCircle className="h-4 w-4 text-muted-foreground" />}
                        {n.title}
                      </CardTitle>
                      <Badge variant={meta.tone}>{meta.label}</Badge>
                    </div>
                    {!n.read_at && (
                      <Button size="sm" variant="ghost" onClick={() => onMarkRead(n.id)}>Als gelesen markieren</Button>
                    )}
                  </div>
                </CardHeader>
                {n.body && (
                  <CardContent className="pt-0">
                    <p className="text-sm text-foreground/80">{n.body}</p>
                    <p className="text-xs text-muted-foreground mt-2">{new Date(n.created_at).toLocaleString("de-DE")}</p>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="subs" className="mt-6 space-y-3">
          {subs === null ? <Skel /> : subs.length === 0 ? (
            <EmptyCta />
          ) : subs.map((s) => (
            <Card key={s.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{s.title}</CardTitle>
                    <div className="flex flex-wrap gap-1.5 pt-1.5">
                      <Badge variant="secondary">{s.category}</Badge>
                      <Badge variant="outline">{s.status}</Badge>
                      {s.promoted_definition_id && <Badge>Offiziell verfügbar</Badge>}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{new Date(s.created_at).toLocaleDateString("de-DE")}</span>
                </div>
              </CardHeader>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Skel() { return <div className="text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Lade …</div>; }

function EmptyCta() {
  return (
    <Card>
      <CardContent className="py-10 text-center space-y-3">
        <p className="text-sm text-muted-foreground">Noch keine Beiträge. Reiche deinen ersten Workflow direkt aus der Workbench ein.</p>
        <Button asChild><Link to="/berufs-ki/app">Zur Berufs-KI Workbench</Link></Button>
      </CardContent>
    </Card>
  );
}
