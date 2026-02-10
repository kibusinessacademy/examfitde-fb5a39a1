import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { enqueuePipeline, PIPELINE_TEMPLATES, type PipelineTemplateKey } from '@/lib/jobs/enqueue';
import {
  Rocket, Globe, ShieldCheck, Package, Play, CheckCircle2,
  Loader2, AlertTriangle, ArrowRight, Clock, Workflow
} from 'lucide-react';
import { Link } from 'react-router-dom';

const ICON_MAP: Record<string, React.ElementType> = {
  Rocket, Globe, ShieldCheck, Package,
};

interface Curriculum {
  id: string;
  title: string;
  status: string;
}

export default function WorkflowStudioPage() {
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('curricula')
        .select('id, title, status')
        .order('title');
      setCurricula((data as Curriculum[]) || []);

      const { data: jobs } = await supabase
        .from('job_queue')
        .select('id, job_type, status, created_at, payload')
        .order('created_at', { ascending: false })
        .limit(20);
      setRecentJobs(jobs || []);

      setLoading(false);
    }
    load();
  }, []);

  const refreshJobs = async () => {
    const { data: jobs } = await supabase
      .from('job_queue')
      .select('id, job_type, status, created_at, payload')
      .order('created_at', { ascending: false })
      .limit(20);
    setRecentJobs(jobs || []);
  };

  const handleLaunch = async (templateKey: PipelineTemplateKey) => {
    if (!selectedId) {
      toast.error('Bitte ein Curriculum auswählen');
      return;
    }
    setLaunching(templateKey);
    try {
      const template = PIPELINE_TEMPLATES[templateKey];
      const result = await enqueuePipeline(selectedId, [...template.jobs]);
      toast.success(`${result?.length ?? 0} Jobs in Queue eingereiht`, {
        description: template.label,
      });
      await refreshJobs();
    } catch (err: any) {
      toast.error('Pipeline-Fehler', { description: err.message });
    } finally {
      setLaunching(null);
    }
  };

  const selectedCurriculum = curricula.find(c => c.id === selectedId);

  const getCurriculumIdFromPayload = (payload: any): string | null => {
    if (typeof payload === 'object' && payload?.curriculum_id) {
      return payload.curriculum_id;
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Workflow className="h-6 w-6 text-primary" />
            Workflow Studio
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ende-zu-Ende Automatisierungen · SSOT-konform · Job-Queue-basiert
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin-v2/jobs/dashboard">
            <Clock className="h-4 w-4 mr-1" /> Job Queue
          </Link>
        </Button>
      </div>

      {/* Curriculum Selector */}
      <Card className="glass-card">
        <CardContent className="pt-5">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="flex-1 w-full">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                SSOT Curriculum auswählen
              </label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={loading ? 'Lade Curricula...' : 'Curriculum wählen (UUID)'} />
                </SelectTrigger>
                <SelectContent>
                  {curricula.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        <span>{c.title}</span>
                        <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedCurriculum && (
              <div className="text-xs text-muted-foreground font-mono bg-muted/30 px-3 py-2 rounded-lg">
                {selectedCurriculum.id.slice(0, 8)}…
                <Badge variant="outline" className="ml-2 text-[10px]">{selectedCurriculum.status}</Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Pipeline Templates */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Pipeline-Vorlagen
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(Object.entries(PIPELINE_TEMPLATES) as [PipelineTemplateKey, typeof PIPELINE_TEMPLATES[PipelineTemplateKey]][]).map(([key, tmpl]) => {
            const Icon = ICON_MAP[tmpl.icon] || Rocket;
            const isLaunching = launching === key;
            return (
              <Card key={key} className="glass-card hover:border-primary/30 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    {tmpl.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{tmpl.description}</p>

                  <div className="flex flex-wrap items-center gap-1">
                    {tmpl.jobs.map((j, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-[10px] font-mono">
                          {j.job_type}
                        </Badge>
                        {i < tmpl.jobs.length - 1 && (
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        )}
                      </div>
                    ))}
                  </div>

                  <Button
                    className="w-full"
                    size="sm"
                    disabled={!selectedId || isLaunching}
                    onClick={() => handleLaunch(key)}
                  >
                    {isLaunching ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Wird eingereiht…</>
                    ) : (
                      <><Play className="h-4 w-4 mr-1" /> Workflow starten</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Recent Jobs */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Letzte Jobs
        </h2>
        {recentJobs.length === 0 ? (
          <Card className="glass-card">
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              Keine Jobs in der Queue
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentJobs.map(job => {
              const curId = getCurriculumIdFromPayload(job.payload);
              return (
                <Link key={job.id} to={`/admin-v2/jobs/${job.id}`} className="block">
                  <Card className="glass-card hover:border-primary/20 transition-colors">
                    <CardContent className="py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {job.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-success" />}
                        {job.status === 'failed' && <AlertTriangle className="h-4 w-4 text-destructive" />}
                        {job.status === 'pending' && <Clock className="h-4 w-4 text-muted-foreground" />}
                        {job.status === 'processing' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                        <Badge variant="secondary" className="font-mono text-xs">{job.job_type}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        {curId && (
                          <span className="text-xs text-muted-foreground font-mono">
                            {curId.slice(0, 8)}…
                          </span>
                        )}
                        <Badge variant={
                          job.status === 'completed' ? 'default' :
                          job.status === 'failed' ? 'destructive' :
                          'outline'
                        } className="text-[10px]">
                          {job.status}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
