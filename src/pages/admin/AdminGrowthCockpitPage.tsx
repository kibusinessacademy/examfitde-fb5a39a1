import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Megaphone, FileText, Users, Loader2, Play, RefreshCw,
  TrendingUp, Zap, AlertTriangle, RotateCcw, Eye, ExternalLink,
  CheckCircle2, XCircle, ChevronDown, Wrench
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AdminSheet as Sheet, AdminSheetContent as SheetContent,
  AdminSheetHeader as SheetHeader, AdminSheetTitle as SheetTitle,
  AdminSheetDescription as SheetDescription,
} from "@/components/admin/AdminSheet";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getGrowthContentJobs,
  getSEOPages,
  triggerGenerateGrowthContent,
  triggerGenerateSEOPage,
  type GrowthContentJob,
  type SEOContentPage,
} from "@/features/growth/api/growthApi";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "border-muted-foreground/40 text-muted-foreground bg-muted/30",
    processing: "border-warning/40 text-warning bg-warning/5",
    done: "border-success/40 text-success bg-success/5",
    failed: "border-destructive/40 text-destructive bg-destructive/5",
    draft: "border-muted-foreground/40 text-muted-foreground bg-muted/30",
    live: "border-success/40 text-success bg-success/5",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", colors[status] ?? "")}>
      {status}
    </Badge>
  );
}

function OverviewCards({
  socialPending, socialDone, socialFailed, seoDraft, seoDone,
  onClickPending, onClickFailed,
}: {
  socialPending: number;
  socialDone: number;
  socialFailed: number;
  seoDraft: number;
  seoDone: number;
  onClickPending: () => void;
  onClickFailed: () => void;
}) {
  const cards: { label: string; value: number; icon: typeof Megaphone; tone: string; onClick?: () => void }[] = [
    { label: "Social Pending", value: socialPending, icon: Megaphone, tone: socialPending > 5 ? 'yellow' : 'neutral', onClick: onClickPending },
    { label: "Social Done", value: socialDone, icon: TrendingUp, tone: 'green' },
    { label: "Social Failed", value: socialFailed, icon: XCircle, tone: socialFailed > 0 ? 'red' : 'neutral', onClick: onClickFailed },
    { label: "SEO Draft", value: seoDraft, icon: FileText, tone: seoDraft > 5 ? 'yellow' : 'neutral' },
    { label: "SEO Done", value: seoDone, icon: Zap, tone: 'green' },
  ];

  const toneClasses = {
    green: 'border-success/30 bg-success/5',
    yellow: 'border-warning/30 bg-warning/5',
    red: 'border-destructive/30 bg-destructive/5',
    neutral: 'border-border bg-card',
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className={cn(
            "rounded-xl border p-3 space-y-1",
            toneClasses[c.tone],
            c.onClick && "cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          )}
          onClick={c.onClick}
          role={c.onClick ? 'button' : undefined}
        >
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <c.icon className="h-3.5 w-3.5" />
            {c.label}
          </div>
          <div className="text-xl font-bold text-foreground">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Job Detail Sheet ── */
function JobDetailSheet({ job, open, onOpenChange }: { job: GrowthContentJob | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: (jobId: string) => triggerGenerateGrowthContent(jobId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["growth-content-jobs"] });
      toast.success("Job neu gestartet");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  if (!job) return null;
  const result = job.result as Record<string, unknown> | null;
  const payload = job.payload as Record<string, unknown> | null;

  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            {job.content_type} · {job.platform}
          </SheetTitle>
          <SheetDescription>Job {job.id.slice(0, 8)} · {job.audience}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <StatusBadge status={job.status} />

          {result?.title && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">Generierter Titel</div>
              <div className="text-sm text-foreground bg-muted/30 rounded-lg p-2">{String(result.title)}</div>
            </div>
          )}

          {result?.error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2">
              <div className="text-[10px] text-destructive font-medium flex items-center gap-1 mb-1">
                <AlertTriangle className="h-3 w-3" /> Fehler
              </div>
              <div className="text-[11px] text-muted-foreground">{String(result.error)}</div>
            </div>
          )}

          {payload && Object.keys(payload).length > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">Payload</div>
              <pre className="text-[10px] bg-muted/50 rounded-lg p-2 overflow-x-auto max-h-32 text-muted-foreground">
                {JSON.stringify(payload, null, 2)}
              </pre>
            </div>
          )}

          {result && Object.keys(result).length > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">Result</div>
              <pre className="text-[10px] bg-muted/50 rounded-lg p-2 overflow-x-auto max-h-48 text-muted-foreground">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground">
            Erstellt: {new Date(job.created_at).toLocaleString('de-DE')}
            {job.updated_at !== job.created_at && <> · Aktualisiert: {new Date(job.updated_at).toLocaleString('de-DE')}</>}
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <div className="text-xs font-semibold text-foreground">Aktionen</div>
            {(job.status === 'pending' || job.status === 'failed') && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => retry.mutate(job.id)}
                disabled={retry.isPending}
              >
                {retry.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
                {job.status === 'failed' ? 'Erneut generieren' : 'Jetzt generieren'}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── SEO Page Detail Sheet ── */
function SeoDetailSheet({ page, open, onOpenChange }: { page: SEOContentPage | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const generate = useMutation({
    mutationFn: (pageId: string) => triggerGenerateSEOPage(pageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seo-pages"] });
      toast.success("SEO-Seite generiert");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  if (!page) return null;

  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {page.title}
          </SheetTitle>
          <SheetDescription>/{page.slug} · {page.page_type}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <StatusBadge status={page.status} />

          {page.meta_description && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">Meta Description</div>
              <div className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-2">{page.meta_description}</div>
            </div>
          )}

          {page.content_md && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">Content (Markdown)</div>
              <pre className="text-[10px] bg-muted/50 rounded-lg p-2 overflow-x-auto max-h-48 text-muted-foreground whitespace-pre-wrap">
                {page.content_md.slice(0, 1000)}{page.content_md.length > 1000 ? '…' : ''}
              </pre>
            </div>
          )}

          {page.faq_json && page.faq_json.length > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">FAQ ({page.faq_json.length})</div>
              <div className="space-y-1">
                {page.faq_json.slice(0, 5).map((faq, i) => (
                  <div key={i} className="rounded-lg border border-border p-2">
                    <div className="text-[11px] font-medium text-foreground">{faq.q}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{faq.a}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-border pt-3 space-y-2">
            <div className="text-xs font-semibold text-foreground">Aktionen</div>
            {page.status === 'draft' && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => generate.mutate(page.id)}
                disabled={generate.isPending}
              >
                {generate.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5 mr-1.5" />}
                Jetzt generieren
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SocialTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string | undefined>();
  const [selectedJob, setSelectedJob] = useState<GrowthContentJob | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["growth-content-jobs", filter],
    queryFn: () => getGrowthContentJobs(filter),
    staleTime: 30_000,
  });

  const generate = useMutation({
    mutationFn: (jobId?: string) => triggerGenerateGrowthContent(jobId),
    onSuccess: () => {
      toast.success("Content generiert");
      qc.invalidateQueries({ queryKey: ["growth-content-jobs"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const batchRetry = useMutation({
    mutationFn: async () => {
      const failed = jobs.filter(j => j.status === 'failed');
      let count = 0;
      for (const j of failed.slice(0, 5)) {
        await triggerGenerateGrowthContent(j.id);
        count++;
      }
      return count;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["growth-content-jobs"] });
      toast.success(`${count} fehlgeschlagene Jobs neu gestartet`);
    },
    onError: (e) => toast.error(e.message),
  });

  const failedCount = jobs.filter(j => j.status === 'failed').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {[undefined, "pending", "processing", "done", "failed"].map((s) => (
          <Button
            key={s ?? "all"}
            variant={filter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(s === filter ? undefined : s)}
          >
            {s ?? "Alle"}
            {s === 'failed' && failedCount > 0 && (
              <Badge variant="destructive" className="ml-1 text-[9px] px-1 h-4">{failedCount}</Badge>
            )}
          </Button>
        ))}
        <div className="flex-1" />
        {failedCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => batchRetry.mutate()}
            disabled={batchRetry.isPending}
            className="border-destructive/30 text-destructive"
          >
            {batchRetry.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
            Alle failed retrien ({failedCount})
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => generate.mutate(undefined)}
          disabled={generate.isPending}
        >
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
          Nächsten generieren
        </Button>
      </div>

      {isLoading && <div className="text-muted-foreground text-sm">Lade Jobs…</div>}

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {jobs.slice(0, 50).map((job: GrowthContentJob) => (
          <div
            key={job.id}
            className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => { setSelectedJob(job); setSheetOpen(true); }}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground truncate">
                {job.content_type} · {job.audience} · {job.platform}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {(job.result as any)?.title ?? "—"}
              </div>
            </div>
            <StatusBadge status={job.status} />
            {job.status === "pending" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); generate.mutate(job.id); }}
                disabled={generate.isPending}
              >
                <Play className="h-3 w-3" />
              </Button>
            )}
            {job.status === "failed" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); generate.mutate(job.id); }}
                disabled={generate.isPending}
                className="text-destructive"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
        {jobs.length === 0 && !isLoading && (
          <div className="text-sm text-muted-foreground p-4 text-center">Keine Jobs.</div>
        )}
      </div>

      <JobDetailSheet job={selectedJob} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}

function SEOTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string | undefined>();
  const [selectedPage, setSelectedPage] = useState<SEOContentPage | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: pages = [], isLoading } = useQuery({
    queryKey: ["seo-pages", filter],
    queryFn: () => getSEOPages(filter),
    staleTime: 30_000,
  });

  const generate = useMutation({
    mutationFn: (pageId?: string) => triggerGenerateSEOPage(pageId),
    onSuccess: () => {
      toast.success("SEO-Seite generiert");
      qc.invalidateQueries({ queryKey: ["seo-pages"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {[undefined, "draft", "processing", "done"].map((s) => (
          <Button
            key={s ?? "all"}
            variant={filter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(s === filter ? undefined : s)}
          >
            {s ?? "Alle"}
          </Button>
        ))}
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => generate.mutate(undefined)}
          disabled={generate.isPending}
        >
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
          Nächste generieren
        </Button>
      </div>

      {isLoading && <div className="text-muted-foreground text-sm">Lade SEO-Seiten…</div>}

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {pages.slice(0, 50).map((page: SEOContentPage) => (
          <div
            key={page.id}
            className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => { setSelectedPage(page); setSheetOpen(true); }}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground truncate">
                {page.page_type} · {page.target_audience ?? "allgemein"}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                /{page.slug} — {page.title}
              </div>
            </div>
            <StatusBadge status={page.status} />
            {page.status === "draft" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); generate.mutate(page.id); }}
                disabled={generate.isPending}
              >
                <Play className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
        {pages.length === 0 && !isLoading && (
          <div className="text-sm text-muted-foreground p-4 text-center">Keine SEO-Seiten.</div>
        )}
      </div>

      <SeoDetailSheet page={selectedPage} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}

function LeadsTab() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads-overview"],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase
        .from("leads")
        .select("id, email, curriculum_id, source, intent, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const intentTone: Record<string, string> = {
    purchase: 'border-success/40 text-success bg-success/5',
    trial: 'border-warning/40 text-warning bg-warning/5',
    info: 'border-border text-muted-foreground',
  };

  return (
    <div className="space-y-4">
      {/* Lead summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-lg font-bold text-foreground">{leads.length}</div>
          <div className="text-[11px] text-muted-foreground">Gesamt Leads</div>
        </div>
        <div className="rounded-xl border border-success/30 bg-success/5 p-3">
          <div className="text-lg font-bold text-foreground">{leads.filter(l => (l as any).intent === 'purchase').length}</div>
          <div className="text-[11px] text-muted-foreground">Kauf-Intent</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-lg font-bold text-foreground">
            {leads.filter(l => {
              const d = new Date((l as any).created_at);
              const now = new Date();
              return (now.getTime() - d.getTime()) < 7 * 86400000;
            }).length}
          </div>
          <div className="text-[11px] text-muted-foreground">Letzte 7 Tage</div>
        </div>
      </div>

      {isLoading && <div className="text-muted-foreground text-sm">Lade Leads…</div>}
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {leads.map((lead: any) => (
          <div
            key={lead.id}
            className="rounded-xl border border-border bg-card p-3 cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground truncate">{lead.email}</div>
                <div className="text-xs text-muted-foreground">
                  {lead.source} · {new Date(lead.created_at).toLocaleDateString("de-DE")}
                </div>
              </div>
              <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", intentTone[lead.intent] || '')}>
                {lead.intent}
              </Badge>
            </div>
            {expandedId === lead.id && (
              <div className="mt-2 border-t border-border pt-2 space-y-1">
                {lead.curriculum_id && (
                  <div className="text-[10px] text-muted-foreground">Curriculum: <span className="font-mono">{lead.curriculum_id.slice(0, 8)}</span></div>
                )}
                <div className="text-[10px] text-muted-foreground">Quelle: {lead.source}</div>
                <div className="text-[10px] text-muted-foreground">Erstellt: {new Date(lead.created_at).toLocaleString('de-DE')}</div>
              </div>
            )}
          </div>
        ))}
        {leads.length === 0 && !isLoading && (
          <div className="text-sm text-muted-foreground p-4 text-center">Noch keine Leads.</div>
        )}
      </div>
    </div>
  );
}

export default function AdminGrowthCockpitPage() {
  const { data: jobs = [] } = useQuery({
    queryKey: ["growth-content-jobs"],
    queryFn: () => getGrowthContentJobs(),
    staleTime: 30_000,
  });

  const { data: seoPages = [] } = useQuery({
    queryKey: ["seo-pages"],
    queryFn: () => getSEOPages(),
    staleTime: 30_000,
  });

  const socialPending = jobs.filter((j: GrowthContentJob) => j.status === "pending").length;
  const socialDone = jobs.filter((j: GrowthContentJob) => j.status === "done").length;
  const socialFailed = jobs.filter((j: GrowthContentJob) => j.status === "failed").length;
  const seoDraft = seoPages.filter((p: SEOContentPage) => p.status === "draft").length;
  const seoDone = seoPages.filter((p: SEOContentPage) => p.status === "done").length;

  const [activeTab, setActiveTab] = useState('social');
  const qc = useQueryClient();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Growth Cockpit</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Social Content, SEO-Seiten und Leads zentral steuern.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["growth-content-jobs"] });
            qc.invalidateQueries({ queryKey: ["seo-pages"] });
            qc.invalidateQueries({ queryKey: ["leads-overview"] });
          }}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Aktualisieren
        </Button>
      </div>

      {/* Alert banners */}
      {socialFailed > 0 && (
        <div
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-3 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => setActiveTab('social')}
          role="button"
        >
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-foreground">{socialFailed} Social-Content-Job(s) fehlgeschlagen</div>
            <div className="text-[11px] text-muted-foreground">Klicken um den Social Tab zu öffnen und fehlgeschlagene Jobs zu retrien.</div>
          </div>
        </div>
      )}

      <OverviewCards
        socialPending={socialPending}
        socialDone={socialDone}
        socialFailed={socialFailed}
        seoDraft={seoDraft}
        seoDone={seoDone}
        onClickPending={() => setActiveTab('social')}
        onClickFailed={() => setActiveTab('social')}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="social">
            <Megaphone className="h-4 w-4 mr-1" />
            Social Content
            {socialFailed > 0 && <Badge variant="destructive" className="ml-1 text-[9px] px-1 h-4">{socialFailed}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="seo">
            <FileText className="h-4 w-4 mr-1" />
            SEO-Seiten
          </TabsTrigger>
          <TabsTrigger value="leads">
            <Users className="h-4 w-4 mr-1" />
            Leads
          </TabsTrigger>
        </TabsList>

        <TabsContent value="social">
          <SocialTab />
        </TabsContent>
        <TabsContent value="seo">
          <SEOTab />
        </TabsContent>
        <TabsContent value="leads">
          <LeadsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
