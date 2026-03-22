import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles, Video, FileText, BarChart3, Loader2, Play, CheckCircle, XCircle, Eye, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'outline' | 'destructive'; label: string }> = {
  queued: { variant: 'outline', label: 'Queued' },
  running: { variant: 'secondary', label: 'Running' },
  generated: { variant: 'secondary', label: 'Generiert' },
  needs_review: { variant: 'default', label: 'Review' },
  approved: { variant: 'default', label: 'Freigegeben' },
  publish_queued: { variant: 'default', label: 'Publish Queue' },
  published: { variant: 'default', label: 'Published' },
  failed: { variant: 'destructive', label: 'Failed' },
  archived: { variant: 'outline', label: 'Archiviert' },
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
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showScriptDialog, setShowScriptDialog] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    question_id: '',
    blueprint_id: '',
    content_category: 'reichweite',
    format: '1min_ihk_frage',
    platform: 'tiktok',
    target_audience: 'azubi',
  });

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
      const d = data || [];
      return {
        total: d.length,
        queued: d.filter(j => j.status === 'queued').length,
        running: d.filter(j => j.status === 'running').length,
        generated: d.filter(j => j.status === 'generated').length,
        needs_review: d.filter(j => j.status === 'needs_review').length,
        approved: d.filter(j => j.status === 'approved').length,
        published: d.filter(j => j.status === 'published').length,
        failed: d.filter(j => j.status === 'failed').length,
      };
    },
  });

  // Enqueue a new content job
  const enqueueJob = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string> = {
        content_category: createForm.content_category,
        format: createForm.format,
        platform: createForm.platform,
        target_audience: createForm.target_audience,
      };
      if (createForm.question_id.trim()) payload.question_id = createForm.question_id.trim();
      if (createForm.blueprint_id.trim()) payload.blueprint_id = createForm.blueprint_id.trim();

      if (!payload.question_id && !payload.blueprint_id) {
        throw new Error('question_id oder blueprint_id erforderlich');
      }

      const { data, error } = await supabase.functions.invoke('generate-content', { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['content-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['content-engine-stats'] });
      toast.success('Job eingereiht', { description: `ID: ${data.content_job_id?.slice(0, 8)}` });
      setShowCreateDialog(false);
      setCreateForm(f => ({ ...f, question_id: '', blueprint_id: '' }));
    },
    onError: (err: Error) => toast.error('Fehler', { description: err.message }),
  });

  // Trigger worker processing
  const processJobs = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('generate-content', {
        body: { mode: 'process', limit: 3 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['content-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['content-engine-stats'] });
      toast.success(`${data.processed} Jobs verarbeitet`);
    },
    onError: (err: Error) => toast.error('Worker-Fehler', { description: err.message }),
  });

  // Status transition
  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === 'published') updates.published_at = new Date().toISOString();
      if (status === 'approved') {
        updates.approved_at = new Date().toISOString();
        // Note: approved_by requires auth context — set from session if available
      }
      if (status === 'needs_review') {
        updates.reviewed_at = new Date().toISOString();
      }
      const { error } = await supabase.from('content_jobs').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['content-engine-stats'] });
      toast.success('Status aktualisiert');
    },
  });

  // Retry failed
  const retryJob = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('content_jobs').update({
        status: 'queued',
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-jobs'] });
      toast.success('Job re-enqueued');
    },
  });

  const selectedScript = showScriptDialog ? jobs?.find(j => j.id === showScriptDialog) : null;

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
        {[
          { label: 'Gesamt', value: stats?.total || 0 },
          { label: 'Queued', value: stats?.queued || 0 },
          { label: 'Running', value: stats?.running || 0 },
          { label: 'Generiert', value: stats?.generated || 0 },
          { label: 'Review', value: stats?.needs_review || 0 },
          { label: 'Approved', value: stats?.approved || 0 },
          { label: 'Published', value: stats?.published || 0 },
          { label: 'Failed', value: stats?.failed || 0 },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-3 pb-2 px-3">
              <div className="text-[10px] text-muted-foreground">{s.label}</div>
              <div className="text-xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Status</SelectItem>
              {Object.entries(statusConfig).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
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

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => processJobs.mutate()}
            disabled={processJobs.isPending || (stats?.queued || 0) === 0}
          >
            {processJobs.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Worker starten ({stats?.queued || 0})
          </Button>

          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button>
                <Sparkles className="h-4 w-4 mr-2" />
                Job anlegen
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Content-Job anlegen</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Question ID</Label>
                  <Input
                    placeholder="UUID der approved Prüfungsfrage"
                    value={createForm.question_id}
                    onChange={e => setCreateForm(f => ({ ...f, question_id: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Blueprint ID (alternativ)</Label>
                  <Input
                    placeholder="UUID des Blueprints"
                    value={createForm.blueprint_id}
                    onChange={e => setCreateForm(f => ({ ...f, blueprint_id: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Kategorie</Label>
                    <Select value={createForm.content_category} onValueChange={v => setCreateForm(f => ({ ...f, content_category: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="reichweite">Reichweite</SelectItem>
                        <SelectItem value="vertrauen">Vertrauen</SelectItem>
                        <SelectItem value="conversion">Conversion</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Format</Label>
                    <Select value={createForm.format} onValueChange={v => setCreateForm(f => ({ ...f, format: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1min_ihk_frage">1 Min IHK Frage</SelectItem>
                        <SelectItem value="fehleranalyse">Fehleranalyse</SelectItem>
                        <SelectItem value="post">Post</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Plattform</Label>
                    <Select value={createForm.platform} onValueChange={v => setCreateForm(f => ({ ...f, platform: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tiktok">TikTok</SelectItem>
                        <SelectItem value="instagram">Instagram</SelectItem>
                        <SelectItem value="youtube">YouTube</SelectItem>
                        <SelectItem value="linkedin">LinkedIn</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Zielgruppe</Label>
                    <Select value={createForm.target_audience} onValueChange={v => setCreateForm(f => ({ ...f, target_audience: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="azubi">Azubi</SelectItem>
                        <SelectItem value="betrieb">Betrieb</SelectItem>
                        <SelectItem value="institution">Institution</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  onClick={() => enqueueJob.mutate()}
                  disabled={(!createForm.question_id.trim() && !createForm.blueprint_id.trim()) || enqueueJob.isPending}
                  className="w-full"
                >
                  {enqueueJob.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Job einreihen
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Jobs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Content Pipeline</CardTitle>
          <CardDescription>Blueprint → Queue → Worker → Script → Review → Publish</CardDescription>
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
                <TableHead>Versuche</TableHead>
                <TableHead>Erstellt</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs?.map((job) => {
                const Icon = contentTypeIcon[job.content_type] || Video;
                const cfg = statusConfig[job.status] || { variant: 'outline' as const, label: job.status };
                return (
                  <TableRow key={job.id}>
                    <TableCell><Icon className="h-4 w-4 text-muted-foreground" /></TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">{job.hook || '–'}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{job.platform}</Badge></TableCell>
                    <TableCell><Badge variant="secondary" className="capitalize">{job.content_category}</Badge></TableCell>
                    <TableCell><Badge variant={cfg.variant}>{cfg.label}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{job.attempt_count || 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(job.created_at), 'dd.MM. HH:mm', { locale: de })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {job.script && (
                          <Button size="sm" variant="ghost" onClick={() => setShowScriptDialog(job.id)} title="Script ansehen">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {job.status === 'generated' && (
                          <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: job.id, status: 'needs_review' })}>
                            Review
                          </Button>
                        )}
                        {job.status === 'needs_review' && (
                          <>
                            <Button size="sm" onClick={() => updateStatus.mutate({ id: job.id, status: 'approved' })}>
                              <CheckCircle className="h-3.5 w-3.5 mr-1" /> Freigeben
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => updateStatus.mutate({ id: job.id, status: 'queued' })}>
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {job.status === 'approved' && (
                          <Button size="sm" onClick={() => updateStatus.mutate({ id: job.id, status: 'published' })}>
                            Publish
                          </Button>
                        )}
                        {job.status === 'failed' && (
                          <Button size="sm" variant="outline" onClick={() => retryJob.mutate(job.id)}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {(!jobs || jobs.length === 0) && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                    Noch keine Content-Jobs. Lege einen Job über „Job anlegen" an.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Script Preview Dialog */}
      <Dialog open={!!showScriptDialog} onOpenChange={() => setShowScriptDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Script Preview</DialogTitle>
          </DialogHeader>
          {selectedScript && (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline" className="capitalize">{selectedScript.platform}</Badge>
                <Badge variant="secondary" className="capitalize">{selectedScript.content_category}</Badge>
                <Badge variant={statusConfig[selectedScript.status]?.variant || 'outline'}>
                  {statusConfig[selectedScript.status]?.label || selectedScript.status}
                </Badge>
              </div>
              {selectedScript.hook && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Hook</div>
                  <p className="text-sm font-medium">„{selectedScript.hook}"</p>
                </div>
              )}
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Script</div>
                <pre className="whitespace-pre-wrap text-sm bg-muted/50 rounded-lg p-4 max-h-[400px] overflow-auto">
                  {selectedScript.script}
                </pre>
              </div>
              {selectedScript.last_error && (
                <div>
                  <div className="text-xs font-medium text-destructive mb-1">Letzter Fehler</div>
                  <p className="text-sm text-destructive">{selectedScript.last_error}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
