import { lazy, Suspense, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, AlertTriangle, RefreshCw, Megaphone, BarChart3,
  Zap, Building2, XCircle, Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ContentEngineTab = lazy(() => import('@/components/marketing/ContentEngineTab'));
const ContentKPITab = lazy(() => import('@/components/marketing/ContentKPITab'));
const HooksTab = lazy(() => import('@/components/marketing/HooksTab'));
const B2BLeadsTab = lazy(() => import('@/components/marketing/B2BLeadsTab'));

const Fallback = () => (
  <div className="flex justify-center py-12">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

export default function MarketingPage() {
  const [activeTab, setActiveTab] = useState('content-engine');
  const qc = useQueryClient();

  // Quick stats for alert banners
  const { data: contentStats } = useQuery({
    queryKey: ['marketing-overview-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_jobs')
        .select('status');
      if (error) return { failed: 0, review: 0, queued: 0 };
      const d = data || [];
      return {
        failed: d.filter(j => j.status === 'failed').length,
        review: d.filter(j => j.status === 'needs_review' || j.status === 'generated').length,
        queued: d.filter(j => j.status === 'queued').length,
      };
    },
    staleTime: 30_000,
  });

  const { data: b2bStats } = useQuery({
    queryKey: ['marketing-b2b-overview'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('b2b_leads')
        .select('status');
      if (error) return { pipeline: 0, stale: 0 };
      const d = data || [];
      const pipeline = d.filter(l => !['closed_won', 'closed_lost'].includes(l.status)).length;
      const stale = d.filter(l => l.status === 'new').length;
      return { pipeline, stale };
    },
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Marketing & Growth Engine</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Content-Automation, KPIs, B2B-Leads und Hooks</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ['content-jobs'] });
            qc.invalidateQueries({ queryKey: ['content-engine-stats'] });
            qc.invalidateQueries({ queryKey: ['b2b-leads'] });
            qc.invalidateQueries({ queryKey: ['marketing-overview-stats'] });
            qc.invalidateQueries({ queryKey: ['marketing-b2b-overview'] });
          }}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Aktualisieren
        </Button>
      </div>

      {/* Quick KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div
          className={cn(
            "rounded-xl border p-3 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all",
            (contentStats?.failed ?? 0) > 0 ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"
          )}
          onClick={() => setActiveTab('content-engine')}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <XCircle className="h-3.5 w-3.5 text-destructive" />
            <span className="text-[11px] text-muted-foreground">Content Failed</span>
          </div>
          <div className="text-lg font-bold text-foreground">{contentStats?.failed ?? 0}</div>
        </div>
        <div
          className={cn(
            "rounded-xl border p-3 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all",
            (contentStats?.review ?? 0) > 0 ? "border-warning/30 bg-warning/5" : "border-border bg-card"
          )}
          onClick={() => setActiveTab('content-engine')}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="h-3.5 w-3.5 text-warning" />
            <span className="text-[11px] text-muted-foreground">Warten auf Review</span>
          </div>
          <div className="text-lg font-bold text-foreground">{contentStats?.review ?? 0}</div>
        </div>
        <div
          className="rounded-xl border border-border bg-card p-3 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => setActiveTab('content-engine')}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Megaphone className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] text-muted-foreground">In Queue</span>
          </div>
          <div className="text-lg font-bold text-foreground">{contentStats?.queued ?? 0}</div>
        </div>
        <div
          className={cn(
            "rounded-xl border p-3 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all",
            (b2bStats?.stale ?? 0) > 3 ? "border-warning/30 bg-warning/5" : "border-border bg-card"
          )}
          onClick={() => setActiveTab('b2b')}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Building2 className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] text-muted-foreground">B2B Pipeline</span>
          </div>
          <div className="text-lg font-bold text-foreground">{b2bStats?.pipeline ?? 0}</div>
        </div>
      </div>

      {/* Alert banners */}
      {(contentStats?.failed ?? 0) > 0 && (
        <div
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-3 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => setActiveTab('content-engine')}
          role="button"
        >
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-foreground">{contentStats?.failed} Content-Job(s) fehlgeschlagen</div>
            <div className="text-[11px] text-muted-foreground">Content Engine öffnen → Worker starten oder fehlgeschlagene Jobs retrien.</div>
          </div>
        </div>
      )}

      {(contentStats?.review ?? 0) > 3 && (
        <div
          className="rounded-xl border border-warning/30 bg-warning/5 p-3 flex items-start gap-3 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => setActiveTab('content-engine')}
          role="button"
        >
          <Clock className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-foreground">{contentStats?.review} Content-Stücke warten auf Review</div>
            <div className="text-[11px] text-muted-foreground">Generierte Inhalte prüfen und freigeben.</div>
          </div>
        </div>
      )}

      {(b2bStats?.stale ?? 0) > 3 && (
        <div
          className="rounded-xl border border-warning/30 bg-warning/5 p-3 flex items-start gap-3 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
          onClick={() => setActiveTab('b2b')}
          role="button"
        >
          <Building2 className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-foreground">{b2bStats?.stale} neue B2B-Leads unbearbeitet</div>
            <div className="text-[11px] text-muted-foreground">Neue Leads kontaktieren und Status aktualisieren.</div>
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="content-engine">
            <Megaphone className="h-3.5 w-3.5 mr-1" />
            Content Engine
            {(contentStats?.failed ?? 0) > 0 && (
              <Badge variant="destructive" className="ml-1 text-[9px] px-1 h-4">{contentStats?.failed}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="kpi">
            <BarChart3 className="h-3.5 w-3.5 mr-1" />
            KPI Dashboard
          </TabsTrigger>
          <TabsTrigger value="hooks">
            <Zap className="h-3.5 w-3.5 mr-1" />
            Hooks
          </TabsTrigger>
          <TabsTrigger value="b2b">
            <Building2 className="h-3.5 w-3.5 mr-1" />
            B2B Leads
            {(b2bStats?.stale ?? 0) > 0 && (
              <Badge variant="outline" className="ml-1 text-[9px] px-1 h-4 border-warning/40 text-warning">{b2bStats?.stale}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <Suspense fallback={<Fallback />}>
          <TabsContent value="content-engine"><ContentEngineTab /></TabsContent>
          <TabsContent value="kpi"><ContentKPITab /></TabsContent>
          <TabsContent value="hooks"><HooksTab /></TabsContent>
          <TabsContent value="b2b"><B2BLeadsTab /></TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
