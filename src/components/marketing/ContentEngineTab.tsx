import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Video, FileText, BarChart3, Eye, ThumbsUp, Share2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const statusBadge: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  queued: 'outline',
  generating: 'secondary',
  generated: 'secondary',
  review: 'default',
  approved: 'default',
  published: 'default',
  failed: 'destructive',
};

const contentTypeIcon: Record<string, typeof Video> = {
  video: Video,
  post: FileText,
  carousel: BarChart3,
  reel: Video,
  story: Video,
};

export default function ContentEngineTab() {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPlatform, setFilterPlatform] = useState<string>('all');

  const { data: jobs, isLoading } = useQuery({
    queryKey: ['content-jobs', filterStatus, filterPlatform],
    queryFn: async () => {
      let query = supabase
        .from('content_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (filterStatus !== 'all') query = query.eq('status', filterStatus);
      if (filterPlatform !== 'all') query = query.eq('platform', filterPlatform);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['content-engine-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_jobs')
        .select('status, content_category');
      if (error) throw error;

      const total = data?.length || 0;
      const generated = data?.filter(j => j.status === 'generated').length || 0;
      const published = data?.filter(j => j.status === 'published').length || 0;
      const failed = data?.filter(j => j.status === 'failed').length || 0;
      const reichweite = data?.filter(j => j.content_category === 'reichweite').length || 0;
      const vertrauen = data?.filter(j => j.content_category === 'vertrauen').length || 0;
      const conversion = data?.filter(j => j.content_category === 'conversion').length || 0;

      return { total, generated, published, failed, reichweite, vertrauen, conversion };
    },
  });

  const generateContent = useMutation({
    mutationFn: async (params: { blueprint_id?: string; question_id?: string; format?: string; content_category?: string }) => {
      const { data, error } = await supabase.functions.invoke('generate-content', {
        body: {
          ...params,
          content_type: 'video',
          platform: 'tiktok',
          target_audience: 'azubi',
          content_category: params.content_category || 'reichweite',
          format: params.format || '1min_ihk_frage',
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['content-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['content-engine-stats'] });
      toast.success('Content generiert!', { description: `Job ID: ${data.content_job_id?.slice(0, 8)}` });
    },
    onError: (err: Error) => {
      toast.error('Content-Generierung fehlgeschlagen', { description: err.message });
    },
  });

  const updateJobStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === 'published') updates.published_at = new Date().toISOString();
      const { error } = await supabase.from('content_jobs').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['content-engine-stats'] });
      toast.success('Status aktualisiert');
    },
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Gesamt', value: stats?.total || 0, color: 'text-foreground' },
          { label: 'Generiert', value: stats?.generated || 0, color: 'text-blue-600' },
          { label: 'Veröffentlicht', value: stats?.published || 0, color: 'text-green-600' },
          { label: 'Fehlgeschlagen', value: stats?.failed || 0, color: 'text-destructive' },
          { label: 'Reichweite', value: stats?.reichweite || 0, color: 'text-purple-600' },
          { label: 'Vertrauen', value: stats?.vertrauen || 0, color: 'text-amber-600' },
          { label: 'Conversion', value: stats?.conversion || 0, color: 'text-emerald-600' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Generate Button + Filters */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="generated">Generiert</SelectItem>
              <SelectItem value="review">Review</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterPlatform} onValueChange={setFilterPlatform}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Plattform" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              <SelectItem value="tiktok">TikTok</SelectItem>
              <SelectItem value="instagram">Instagram</SelectItem>
              <SelectItem value="youtube">YouTube</SelectItem>
              <SelectItem value="linkedin">LinkedIn</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={() => {
            toast.info('Wähle eine Frage oder Blueprint im Prüfungstrainer, um Content zu generieren.');
          }}
          disabled={generateContent.isPending}
        >
          {generateContent.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Content generieren
        </Button>
      </div>

      {/* Jobs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Content Pipeline</CardTitle>
          <CardDescription>Blueprint → Script → Video → Distribution</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Typ</TableHead>
                <TableHead>Hook</TableHead>
                <TableHead>Plattform</TableHead>
                <TableHead>Kategorie</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Erstellt</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs?.map((job) => {
                const Icon = contentTypeIcon[job.content_type] || Video;
                return (
                  <TableRow key={job.id}>
                    <TableCell><Icon className="h-4 w-4 text-muted-foreground" /></TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">
                      {job.hook || '–'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{job.platform}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">{job.content_category}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadge[job.status] || 'outline'}>{job.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(job.created_at), 'dd.MM. HH:mm', { locale: de })}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {job.status === 'generated' && (
                        <Button size="sm" variant="outline" onClick={() => updateJobStatus.mutate({ id: job.id, status: 'review' })}>
                          Review
                        </Button>
                      )}
                      {job.status === 'review' && (
                        <Button size="sm" onClick={() => updateJobStatus.mutate({ id: job.id, status: 'approved' })}>
                          Freigeben
                        </Button>
                      )}
                      {job.status === 'approved' && (
                        <Button size="sm" onClick={() => updateJobStatus.mutate({ id: job.id, status: 'published' })}>
                          Veröffentlichen
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(!jobs || jobs.length === 0) && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                    Noch kein Content generiert. Starte die Engine über Blueprint → Content.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Script Preview for latest generated */}
      {jobs && jobs.length > 0 && jobs[0].script && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Letztes Script</CardTitle>
            <CardDescription>{jobs[0].hook}</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm bg-muted/50 rounded-lg p-4 max-h-[300px] overflow-auto">
              {jobs[0].script}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
