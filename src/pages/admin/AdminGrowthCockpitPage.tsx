import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Megaphone, FileText, Users, Loader2, Play, RefreshCw,
  TrendingUp, Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
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
    pending: "bg-muted text-muted-foreground",
    processing: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    done: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    draft: "bg-muted text-muted-foreground",
    live: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${colors[status] ?? "bg-muted"}`}>
      {status}
    </span>
  );
}

function OverviewCards({
  socialPending,
  socialDone,
  seoDraft,
  seoDone,
}: {
  socialPending: number;
  socialDone: number;
  seoDraft: number;
  seoDone: number;
}) {
  const cards = [
    { label: "Social Pending", value: socialPending, icon: Megaphone },
    { label: "Social Done", value: socialDone, icon: TrendingUp },
    { label: "SEO Draft", value: seoDraft, icon: FileText },
    { label: "SEO Done", value: seoDone, icon: Zap },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-2xl border p-4 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <c.icon className="h-4 w-4" />
            {c.label}
          </div>
          <div className="text-2xl font-bold">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function SocialTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string | undefined>();

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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {[undefined, "pending", "processing", "done"].map((s) => (
          <Button
            key={s ?? "all"}
            variant={filter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(s)}
          >
            {s ?? "Alle"}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => generate.mutate(undefined)}
          disabled={generate.isPending}
        >
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
          Nächsten Job generieren
        </Button>
      </div>

      {isLoading && <div className="text-muted-foreground">Lade Jobs…</div>}

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {jobs.slice(0, 50).map((job: GrowthContentJob) => (
          <div key={job.id} className="rounded-xl border p-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
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
                onClick={() => generate.mutate(job.id)}
                disabled={generate.isPending}
              >
                <Play className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
        {jobs.length === 0 && !isLoading && (
          <div className="text-sm text-muted-foreground p-4 text-center">Keine Jobs.</div>
        )}
      </div>
    </div>
  );
}

function SEOTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string | undefined>();

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
            onClick={() => setFilter(s)}
          >
            {s ?? "Alle"}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => generate.mutate(undefined)}
          disabled={generate.isPending}
        >
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
          Nächste Seite generieren
        </Button>
      </div>

      {isLoading && <div className="text-muted-foreground">Lade SEO-Seiten…</div>}

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {pages.slice(0, 50).map((page: SEOContentPage) => (
          <div key={page.id} className="rounded-xl border p-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
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
                onClick={() => generate.mutate(page.id)}
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
    </div>
  );
}

function LeadsTab() {
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

  return (
    <div className="space-y-4">
      {isLoading && <div className="text-muted-foreground">Lade Leads…</div>}
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {leads.map((lead: any) => (
          <div key={lead.id} className="rounded-xl border p-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{lead.email}</div>
              <div className="text-xs text-muted-foreground">
                {lead.source} · {lead.intent} · {new Date(lead.created_at).toLocaleDateString("de-DE")}
              </div>
            </div>
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
  const seoDraft = seoPages.filter((p: SEOContentPage) => p.status === "draft").length;
  const seoDone = seoPages.filter((p: SEOContentPage) => p.status === "done").length;

  const qc = useQueryClient();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Growth Cockpit</h1>
          <p className="text-muted-foreground mt-1">
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
          <RefreshCw className="h-4 w-4 mr-1" />
          Aktualisieren
        </Button>
      </div>

      <OverviewCards
        socialPending={socialPending}
        socialDone={socialDone}
        seoDraft={seoDraft}
        seoDone={seoDone}
      />

      <Tabs defaultValue="social">
        <TabsList>
          <TabsTrigger value="social">
            <Megaphone className="h-4 w-4 mr-1" />
            Social Content
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
