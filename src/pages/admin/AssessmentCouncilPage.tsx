import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, ShieldCheck, FileQuestion, ListChecks, Play, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const statusBadge = (status: string) => {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle }> = {
    approved: { variant: 'default', icon: CheckCircle },
    rejected: { variant: 'destructive', icon: XCircle },
    draft: { variant: 'outline', icon: AlertTriangle },
    review: { variant: 'secondary', icon: Loader2 },
    proposed: { variant: 'outline', icon: AlertTriangle },
    under_review: { variant: 'secondary', icon: Loader2 },
    revise: { variant: 'secondary', icon: AlertTriangle },
  };
  const cfg = map[status] ?? map.draft;
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {status}
    </Badge>
  );
};

export default function AssessmentCouncilPage() {
  const [runningJob, setRunningJob] = useState<string | null>(null);

  // Blueprints
  const { data: blueprints, isLoading: bpLoading } = useQuery({
    queryKey: ['assessment-blueprints'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('question_blueprints')
        .select('id, name, status, canonical_statement, cognitive_level, exam_relevance, approved_version_id, updated_at')
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // Exam Questions stats
  const { data: questionStats } = useQuery({
    queryKey: ['assessment-question-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_questions')
        .select('status')
        .limit(5000);
      if (error) throw error;
      const counts = { draft: 0, review: 0, approved: 0, rejected: 0, total: 0 };
      (data ?? []).forEach((q: { status: string | null }) => {
        counts.total++;
        const s = q.status ?? 'draft';
        if (s in counts) (counts as Record<string, number>)[s]++;
      });
      return counts;
    },
  });

  // MiniCheck Sets
  const { data: minicheckSets, isLoading: mcLoading } = useQuery({
    queryKey: ['assessment-minicheck-sets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('minicheck_sets')
        .select('id, course_id, lesson_id, status, question_count, approved_version_id, updated_at')
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // Council Verdicts for assessment
  const { data: verdicts } = useQuery({
    queryKey: ['assessment-verdicts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('council_verdicts')
        .select('id, content_version_id, final_decision, consensus_score, decided_at, decided_by')
        .eq('decided_by', 'assessment-council')
        .order('decided_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const enqueueJob = async (jobType: string, payload: Record<string, unknown>) => {
    setRunningJob(jobType);
    try {
      const { error } = await supabase.from('job_queue').insert([{
        job_type: jobType,
        payload: payload as unknown as import('@/integrations/supabase/types').Json,
        priority: 2,
        max_attempts: 3,
      }]);
      if (error) throw error;
      toast.success(`Job "${jobType}" eingereiht`);
    } catch (e) {
      toast.error(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunningJob(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Blueprints
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{blueprints?.length ?? '–'}</div>
            <p className="text-xs text-muted-foreground">
              {blueprints?.filter(b => b.status === 'approved').length ?? 0} approved
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileQuestion className="h-4 w-4" /> Exam Questions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{questionStats?.total ?? '–'}</div>
            <p className="text-xs text-muted-foreground">
              {questionStats?.approved ?? 0} approved / {questionStats?.draft ?? 0} draft
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ListChecks className="h-4 w-4" /> MiniCheck Sets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{minicheckSets?.length ?? '–'}</div>
            <p className="text-xs text-muted-foreground">
              {minicheckSets?.filter(m => m.status === 'approved').length ?? 0} approved
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4" /> Verdicts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{verdicts?.length ?? '–'}</div>
            <p className="text-xs text-muted-foreground">
              {verdicts?.filter(v => v.final_decision === 'approved').length ?? 0} approved
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="blueprints">
        <TabsList>
          <TabsTrigger value="blueprints">Blueprints</TabsTrigger>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="minichecks">MiniChecks</TabsTrigger>
          <TabsTrigger value="history">Verdict History</TabsTrigger>
        </TabsList>

        {/* Blueprints Tab */}
        <TabsContent value="blueprints">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Question Blueprints</CardTitle>
            </CardHeader>
            <CardContent>
              {bpLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Kognitiv</TableHead>
                      <TableHead>Relevanz</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Aktion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(blueprints ?? []).map(bp => (
                      <TableRow key={bp.id}>
                        <TableCell className="font-medium max-w-[200px] truncate">{bp.name}</TableCell>
                        <TableCell><Badge variant="outline">{bp.cognitive_level}</Badge></TableCell>
                        <TableCell><Badge variant="outline">{bp.exam_relevance}</Badge></TableCell>
                        <TableCell>{statusBadge(bp.status)}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={runningJob !== null}
                            onClick={() => enqueueJob('assessment_blueprint_propose', { entityType: 'blueprint', blueprintId: bp.id })}
                          >
                            <Play className="h-3 w-3 mr-1" /> Council
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Questions Tab */}
        <TabsContent value="questions">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Exam Questions Council</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-4 gap-3 text-center">
                {['draft', 'review', 'approved', 'rejected'].map(s => (
                  <div key={s} className="p-3 rounded-lg bg-muted/50">
                    <div className="text-lg font-bold">{(questionStats as Record<string, number>)?.[s] ?? 0}</div>
                    <div className="text-xs text-muted-foreground capitalize">{s}</div>
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                Um Exam Questions durch den Council zu schicken, wähle einen approved Blueprint und starte den Questions-Council-Job.
              </p>
              {(blueprints ?? []).filter(b => b.status === 'approved').length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Approved Blueprints – Questions reviewen:</p>
                  {(blueprints ?? []).filter(b => b.status === 'approved').slice(0, 10).map(bp => (
                    <div key={bp.id} className="flex items-center justify-between p-2 rounded border">
                      <span className="text-sm truncate max-w-[300px]">{bp.name}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={runningJob !== null}
                        onClick={() => enqueueJob('assessment_questions_critique', { entityType: 'questions', blueprintId: bp.id })}
                      >
                        <Play className="h-3 w-3 mr-1" /> Review
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Keine approved Blueprints vorhanden. Blueprints zuerst durch Council freigeben.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MiniChecks Tab */}
        <TabsContent value="minichecks">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">MiniCheck Sets</CardTitle>
            </CardHeader>
            <CardContent>
              {mcLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : (minicheckSets ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Keine MiniCheck Sets vorhanden. Sets werden beim Council-Run automatisch erstellt.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lesson ID</TableHead>
                      <TableHead>Fragen</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Aktualisiert</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(minicheckSets ?? []).map(mc => (
                      <TableRow key={mc.id}>
                        <TableCell className="font-mono text-xs">{(mc.lesson_id as string).slice(0, 8)}…</TableCell>
                        <TableCell>{mc.question_count}</TableCell>
                        <TableCell>{statusBadge(mc.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(mc.updated_at).toLocaleDateString('de-DE')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Verdict History (Assessment Council)</CardTitle>
            </CardHeader>
            <CardContent>
              {(verdicts ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Noch keine Council-Entscheidungen.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead>Consensus</TableHead>
                      <TableHead>Datum</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(verdicts ?? []).map(v => (
                      <TableRow key={v.id}>
                        <TableCell className="font-mono text-xs">{(v.content_version_id as string).slice(0, 8)}…</TableCell>
                        <TableCell>{statusBadge(v.final_decision)}</TableCell>
                        <TableCell>{((v.consensus_score as number) * 100).toFixed(0)}%</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(v.decided_at).toLocaleDateString('de-DE')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
