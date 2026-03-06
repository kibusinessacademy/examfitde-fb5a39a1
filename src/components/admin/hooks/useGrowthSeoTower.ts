import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SeoHealthData {
  health_score: number;
  pages: { total: number; published: number; draft: number; review: number };
  blogs: { total: number; published: number; draft: number; missing_meta: number; missing_tags: number };
  seo_gaps: {
    missing_meta_title: Array<{ id: string; title: string; slug: string }>;
    long_meta_title: Array<{ id: string; title: string; length: number }>;
    missing_meta_desc: Array<{ id: string; title: string; slug: string }>;
    long_meta_desc: Array<{ id: string; title: string; length: number }>;
    noindex_published: Array<{ id: string; title: string }>;
  };
  redirects: { total: number; active: number; broken: number };
  backlinks: { total: number; active: number; high_da: number };
  schema_coverage: { total_settings: number; with_structured_data: number };
}

export interface GrowthIntelData {
  churn: {
    total: number;
    high_risk: number;
    medium_risk: number;
    no_action_taken: number;
    top_risks: Array<{
      user_id: string;
      score: number;
      level: string;
      action: string | null;
      signals: Record<string, unknown> | null;
    }>;
  };
  nudges: {
    proposed: number;
    approved: number;
    sent: number;
    failed: number;
    pending_approval: number;
  };
  risk_scores: { total: number; critical: number };
}

export interface PublishReadinessData {
  ready_to_publish: number;
  blocked_packages: number;
  published_total: number;
  ready_packages: Array<{ id: string; title: string; track: string | null; integrity_passed: boolean | null }>;
  blocked_details: Array<{ id: string; title: string; reason: string | null; track: string | null }>;
  active_courses: number;
}

export interface DiagnosedIssue {
  severity: "critical" | "high" | "medium" | "low";
  domain: "seo" | "growth" | "publish" | "content";
  title: string;
  detail: string;
  metric: number;
  recommendation: string;
}

export interface HealthBarItem {
  key: string;
  label: string;
  tone: "green" | "yellow" | "red" | "neutral";
  value: number;
  hint: string;
}

export interface GrowthSeoTowerResponse {
  health: HealthBarItem[];
  seo: SeoHealthData;
  growth: GrowthIntelData;
  publish: PublishReadinessData;
  issues: DiagnosedIssue[];
  generated_at: string;
}

async function fetchGrowthSeoTower(): Promise<GrowthSeoTowerResponse> {
  const { data, error } = await supabase.functions.invoke("admin-growth-seo-tower", {
    body: { action: "overview" },
  });
  if (error) throw error;
  return data as GrowthSeoTowerResponse;
}

export function useGrowthSeoTower() {
  return useQuery({
    queryKey: ["admin", "growth-seo-tower"],
    queryFn: fetchGrowthSeoTower,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}
