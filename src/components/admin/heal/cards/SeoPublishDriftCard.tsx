/**
 * SeoPublishDriftCard — SSOT: prüft, ob jede published Package eine
 * published SEO-Page hat. Heal via admin_seo_publish_drift_heal().
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Wrench } from "lucide-react";
import { toast } from "sonner";

interface DriftRow {
  package_id: string;
  title: string;
  curriculum_id: string | null;
  total_pages: number;
  draft_pages: number;
}

export function SeoPublishDriftCard() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["seo-publish-drift"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_packages")
        .select(
          "id, title, curriculum_id, status, integrity_passed",
        )
        .eq("status", "published")
        .eq("integrity_passed", true);
      if (error) throw error;
      const pkgs = data ?? [];
      const curriculumIds = pkgs
        .map((p: any) => p.curriculum_id)
        .filter(Boolean);
      const { data: pages } = await supabase
        .from("seo_content_pages")
        .select("curriculum_id, status")
        .in("curriculum_id", curriculumIds);
      const byCurr = new Map<string, { total: number; draft: number; published: number }>();
      (pages ?? []).forEach((p: any) => {
        const k = p.curriculum_id;
        if (!byCurr.has(k)) byCurr.set(k, { total: 0, draft: 0, published: 0 });
        const e = byCurr.get(k)!;
        e.total += 1;
        if (p.status === "draft") e.draft += 1;
        if (p.status === "published") e.published += 1;
      });
      return pkgs
        .map((p: any) => {
          const e = byCurr.get(p.curriculum_id) ?? {
            total: 0,
            draft: 0,
            published: 0,
          };
          return {
            package_id: p.id,
            title: p.title,
            curriculum_id: p.curriculum_id,
            total_pages: e.total,
            draft_pages: e.draft,
            published_pages: e.published,
            drift: e.published === 0,
          };
        })
        .filter((r) => r.drift) as (DriftRow & {
        published_pages: number;
        drift: boolean;
      })[];
    },
    refetchInterval: 60_000,
  });

  const heal = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_seo_publish_drift_heal" as any,
      );
      if (error) throw error;
      return data as Array<{ curriculum_id: string; pages_published: number }>;
    },
    onSuccess: (rows) => {
      const total = rows?.reduce((s, r) => s + r.pages_published, 0) ?? 0;
      toast.success(`SEO Drift-Heal: ${total} Pages published`);
      qc.invalidateQueries({ queryKey: ["seo-publish-drift"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Heal fehlgeschlagen"),
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Search className="h-4 w-4" /> SEO ↔ Publish Drift
          <Badge variant="outline" className="text-[10px]">
            {q.data?.length ?? 0} drift
          </Badge>
        </h3>
        <Button
          size="sm"
          disabled={heal.isPending}
          onClick={() => heal.mutate()}
        >
          <Wrench className="h-3.5 w-3.5 mr-1.5" /> Heal Drift
        </Button>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (q.data?.length ?? 0) === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          Alle published Pakete haben mindestens eine published SEO-Page. ✓
        </p>
      ) : (
        <ul className="text-xs space-y-1">
          {q.data!.map((r) => (
            <li
              key={r.package_id}
              className="flex justify-between border-b py-1"
            >
              <span className="truncate">{r.title}</span>
              <span className="text-muted-foreground tabular-nums">
                drafts {r.draft_pages} · total {r.total_pages}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-muted-foreground mt-2">
        SSOT: <code>admin_seo_publish_drift_heal</code> · Trigger{" "}
        <code>trg_auto_publish_seo_pages</code>.
      </p>
    </Card>
  );
}
