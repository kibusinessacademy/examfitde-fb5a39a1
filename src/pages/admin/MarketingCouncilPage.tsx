import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShieldCheck, ShieldAlert, Play, FileText, CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function MarketingCouncilPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Marketing & SEO Council</h1>
        <p className="text-sm text-muted-foreground">
          Deliberativer Content-Prozess: Propose → Critique → Verdict → Publish
        </p>
      </div>

      <Tabs defaultValue="assets" className="space-y-4">
        <TabsList>
          <TabsTrigger value="assets" className="gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" /> Assets
          </TabsTrigger>
          <TabsTrigger value="council" className="gap-1.5 text-xs">
            <Clock className="h-3.5 w-3.5" /> Council Inbox
          </TabsTrigger>
          <TabsTrigger value="published" className="gap-1.5 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" /> Published
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assets"><AssetsPanel /></TabsContent>
        <TabsContent value="council"><CouncilInboxPanel /></TabsContent>
        <TabsContent value="published"><PublishedPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function AssetsPanel() {
  const qc = useQueryClient();
  const { data: assets, isLoading } = useQuery({
    queryKey: ['mktg-council-assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_assets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const runPipeline = useMutation({
    mutationFn: async (assetId: string) => {
      const { data, error } = await supabase.functions.invoke('marketing-council-run', {
        body: { action: 'run_asset', assetId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const d = data as Record<string, unknown>;
      toast.success(`Council Pipeline: ${(d.decision as Record<string, unknown>)?.finalDecision || 'completed'}`);
      qc.invalidateQueries({ queryKey: ['mktg-council-assets'] });
    },
    onError: (e) => toast.error(`Pipeline Error: ${e.message}`),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const statusIcon = (s: string) => {
    if (s === 'published' || s === 'approved' || s === 'validated') return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    if (s === 'rejected') return <XCircle className="h-4 w-4 text-destructive" />;
    return <Clock className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        {['draft', 'generated', 'validated', 'published'].map(s => (
          <Card key={s}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground capitalize">{s}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{assets?.filter(a => a.status === s).length || 0}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Titel</TableHead>
            <TableHead>Typ</TableHead>
            <TableHead>Zielgruppe</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Published</TableHead>
            <TableHead>Aktion</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets?.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium max-w-[200px] truncate">{a.title}</TableCell>
              <TableCell><Badge variant="outline">{a.asset_type}</Badge></TableCell>
              <TableCell><Badge variant="secondary">{(a as Record<string, unknown>).target_audience as string || a.target_group || '–'}</Badge></TableCell>
              <TableCell className="flex items-center gap-1.5">
                {statusIcon(a.status || 'draft')}
                <span className="text-xs">{a.status}</span>
              </TableCell>
              <TableCell>
                {(a as Record<string, unknown>).is_published
                  ? <ShieldCheck className="h-4 w-4 text-green-600" />
                  : <ShieldAlert className="h-4 w-4 text-orange-500" />}
              </TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => runPipeline.mutate(a.id)}
                  disabled={runPipeline.isPending}
                >
                  {runPipeline.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  Council Run
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {assets?.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">Keine Assets vorhanden</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function CouncilInboxPanel() {
  const { data: versions, isLoading } = useQuery({
    queryKey: ['mktg-council-inbox'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_versions')
        .select('id, entity_type, entity_id, status, council_round, created_by_agent, created_at, content_json')
        .in('entity_type', ['landing_page', 'product_copy', 'faq_set', 'blog_post', 'ad_copy'])
        .in('status', ['under_review', 'revise'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Versionen, die auf Review / Überarbeitung warten</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Typ</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Runde</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead>Erstellt</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {versions?.map((v) => (
            <TableRow key={v.id}>
              <TableCell><Badge variant="outline">{v.entity_type}</Badge></TableCell>
              <TableCell><Badge variant={v.status === 'revise' ? 'destructive' : 'secondary'}>{v.status}</Badge></TableCell>
              <TableCell>{v.council_round}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{v.created_by_agent}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString('de-DE')}</TableCell>
            </TableRow>
          ))}
          {(!versions || versions.length === 0) && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">Keine offenen Reviews</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function PublishedPanel() {
  const { data: published, isLoading } = useQuery({
    queryKey: ['mktg-council-published'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_assets')
        .select('id, title, asset_type, slug, status, updated_at')
        .not('published_version_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Council-approved und veröffentlichte Artefakte</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Titel</TableHead>
            <TableHead>Typ</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Zuletzt aktualisiert</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {published?.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.title}</TableCell>
              <TableCell><Badge variant="outline">{p.asset_type}</Badge></TableCell>
              <TableCell className="text-xs text-muted-foreground font-mono">{(p as Record<string, unknown>).slug as string || '–'}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{new Date(p.updated_at).toLocaleString('de-DE')}</TableCell>
            </TableRow>
          ))}
          {(!published || published.length === 0) && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground py-8">Noch keine veröffentlichten Artefakte</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
