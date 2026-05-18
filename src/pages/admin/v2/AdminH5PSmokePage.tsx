import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2, XCircle, MinusCircle, Loader2, Play, Wrench, ExternalLink,
  ChevronDown, ChevronRight, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

type StepStatus = 'ok' | 'fail' | 'skipped' | 'healed';
interface StepResult {
  key: string; label: string; status: StepStatus;
  detail?: string; data?: unknown; healed_action?: string;
}
interface HealedAction { step: string; action: string; ok: boolean; detail?: string }
interface SmokeResult {
  ok: boolean;
  overall: 'green' | 'yellow' | 'red';
  summary: { ok: number; fail: number; healed?: number; total: number };
  steps: StepResult[];
  healed_actions?: HealedAction[];
  revalidation?: { lesson_link_ok: boolean; outcome_ok: boolean; event_present: boolean } | null;
  audit_id?: string | null;
}

const STATUS_ICON: Record<StepStatus, JSX.Element> = {
  ok: <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="ok" />,
  fail: <XCircle className="h-4 w-4 text-destructive" aria-label="fail" />,
  skipped: <MinusCircle className="h-4 w-4 text-text-muted" aria-label="skipped" />,
  healed: <Wrench className="h-4 w-4 text-amber-600" aria-label="healed" />,
};

const OVERALL_BADGE: Record<SmokeResult['overall'], string> = {
  green: 'bg-status-success-bg-subtle text-status-success-text border-status-success-border',
  yellow: 'bg-status-warning-bg-subtle text-status-warning-text border-status-warning-border',
  red: 'bg-status-error-bg-subtle text-status-error-text border-status-error-border',
};

interface RecentRun {
  id: string;
  created_at: string;
  result_status: string | null;
  target_id: string | null;
  metadata: any;
}

export default function AdminH5PSmokePage() {
  const [contentId, setContentId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [curriculumId, setCurriculumId] = useState('');
  const [score, setScore] = useState<number>(85);
  const [autoHeal, setAutoHeal] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SmokeResult | null>(null);
  const [recent, setRecent] = useState<RecentRun[]>([]);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [loadingRecent, setLoadingRecent] = useState(false);

  const loadRecent = async () => {
    setLoadingRecent(true);
    try {
      const { data, error } = await supabase
        .from('auto_heal_log')
        .select('id, created_at, result_status, target_id, metadata')
        .eq('action_type', 'admin_h5p_e2e_smoke')
        .order('created_at', { ascending: false })
        .limit(15);
      if (error) throw error;
      setRecent((data ?? []) as RecentRun[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Recent-Runs konnten nicht geladen werden');
    } finally {
      setLoadingRecent(false);
    }
  };

  useEffect(() => {
    loadRecent();
  }, []);

  const run = async () => {
    if (!contentId || !lessonId) {
      toast.error('content_id und lesson_id erforderlich');
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('admin-h5p-e2e-smoke', {
        body: {
          content_id: contentId.trim(),
          lesson_id: lessonId.trim(),
          curriculum_id: curriculumId.trim() || undefined,
          score,
          auto_heal: autoHeal,
        },
      });
      if (error) throw error;
      const r = data as SmokeResult;
      setResult(r);
      if (r.overall === 'green') toast.success('Alle Schritte grün');
      else if (r.overall === 'yellow') toast.warning('Teilweise erfolgreich');
      else toast.error('Smoke fehlgeschlagen');
      loadRecent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Smoke-Run fehlgeschlagen');
    } finally {
      setRunning(false);
    }
  };

  const autoPick = async () => {
    try {
      const { data: rootList, error: lsErr } = await supabase.storage.from('h5p-content').list('', { limit: 100 });
      if (lsErr) throw lsErr;
      const folder = (rootList ?? []).find((o) => o.name?.startsWith('h5p_'));
      if (folder?.name) setContentId(folder.name);

      const { data: linked } = await supabase
        .from('lessons')
        .select('id, course_id, h5p_content_id')
        .not('h5p_content_id', 'is', null)
        .limit(1);
      let lessonRow: any = (linked ?? [])[0];
      if (!lessonRow) {
        const { data: anyLesson } = await supabase
          .from('lessons')
          .select('id, course_id')
          .order('created_at', { ascending: false })
          .limit(1);
        lessonRow = (anyLesson ?? [])[0];
      }
      if (lessonRow?.id) setLessonId(lessonRow.id);
      if (lessonRow?.course_id) {
        const { data: course } = await supabase
          .from('courses')
          .select('curriculum_id')
          .eq('id', lessonRow.course_id)
          .maybeSingle();
        if (course?.curriculum_id) setCurriculumId(course.curriculum_id);
      }

      if (!folder?.name) toast.warning('Kein H5P-Content im Bucket — bitte zuerst hochladen.');
      else if (!lessonRow?.id) toast.warning('Keine Lesson gefunden.');
      else toast.success('Echtdaten geladen — bereit für Smoke-Run.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Auto-Pick fehlgeschlagen');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">H5P End-to-End Smoke</h1>
        <p className="text-sm text-text-secondary mt-1">
          Verifiziert nach einem Upload die komplette Pipeline: Storage-Objekt, Lesson-Verlinkung,{' '}
          <code>update_lesson_outcome</code>, <code>h5p_completed</code> Event, Exam-Readiness Snapshot.
          Auto-Heal repariert fehlende Lesson-Verlinkung und Outcome und re-validiert anschließend.
        </p>
      </header>

      <Card>
        <CardHeader><CardTitle>Eingaben</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cid">H5P content_id</Label>
            <Input id="cid" value={contentId} onChange={(e) => setContentId(e.target.value)} placeholder="h5p_…" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lid">Lesson UUID</Label>
            <Input id="lid" value={lessonId} onChange={(e) => setLessonId(e.target.value)} placeholder="00000000-…" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="cur">Curriculum UUID (optional)</Label>
              <Input id="cur" value={curriculumId} onChange={(e) => setCurriculumId(e.target.value)} placeholder="für Readiness-Snapshot" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sc">Test-Score (0–100)</Label>
              <Input id="sc" type="number" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} />
            </div>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Switch id="ah" checked={autoHeal} onCheckedChange={setAutoHeal} />
            <Label htmlFor="ah" className="cursor-pointer">
              Auto-Heal aktiv (repariert Lesson-Link + ausstehendes Outcome und re-validiert)
            </Label>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={run} disabled={running} className="w-full sm:w-auto">
              {running ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Läuft…</>) : (<><Play className="h-4 w-4 mr-2" /> Smoke starten</>)}
            </Button>
            <Button onClick={autoPick} type="button" variant="outline" className="w-full sm:w-auto">
              Echtdaten auto-laden
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Ergebnis</CardTitle>
              <div className="flex items-center gap-2">
                {(result.summary.healed ?? 0) > 0 && (
                  <Badge variant="outline" className="text-amber-700 border-amber-500/30">
                    <Wrench className="h-3 w-3 mr-1" /> {result.summary.healed} healed
                  </Badge>
                )}
                <span className={`text-xs font-medium px-2 py-1 rounded-md border ${OVERALL_BADGE[result.overall]}`}>
                  {result.overall.toUpperCase()} — {result.summary.ok}/{result.summary.total} ok
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {result.steps.map((s) => (
                <li key={s.key} className="py-3 flex items-start gap-3">
                  <div className="mt-0.5">{STATUS_ICON[s.status]}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text-primary">
                      {s.label}
                      {s.healed_action && (
                        <span className="ml-2 text-xs text-amber-700">[{s.healed_action}]</span>
                      )}
                    </div>
                    {s.detail && <div className="text-xs text-text-muted break-all">{s.detail}</div>}
                    {s.data !== undefined && s.data !== null && (
                      <pre className="mt-1 text-xs bg-surface-sunken border border-border rounded p-2 overflow-x-auto">
                        {JSON.stringify(s.data, null, 2)}
                      </pre>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Letzte Smoke-Runs</CardTitle>
            <Button size="sm" variant="outline" onClick={loadRecent} disabled={loadingRecent}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loadingRecent ? 'animate-spin' : ''}`} />
              Neu laden
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-text-muted">Keine Smoke-Runs gefunden.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((r) => {
                const meta = r.metadata ?? {};
                const open = openRun === r.id;
                const ok = r.result_status === 'success';
                return (
                  <li key={r.id} className="py-3">
                    <button
                      type="button"
                      className="w-full flex items-start gap-3 text-left"
                      onClick={() => setOpenRun(open ? null : r.id)}
                    >
                      <div className="mt-0.5">
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-text-primary flex items-center gap-2 flex-wrap">
                          <span>{new Date(r.created_at).toLocaleString('de-DE')}</span>
                          <Badge variant={ok ? 'outline' : 'destructive'} className={ok ? 'border-emerald-500/30 text-emerald-700' : ''}>
                            {r.result_status}
                          </Badge>
                          {Array.isArray(meta.healed_actions) && meta.healed_actions.length > 0 && (
                            <Badge variant="outline" className="border-amber-500/30 text-amber-700">
                              <Wrench className="h-3 w-3 mr-1" /> {meta.healed_actions.length}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-text-muted break-all">
                          content_id: <code>{r.target_id}</code>
                          {meta.lesson_id && <> · lesson: <code>{meta.lesson_id}</code></>}
                        </div>
                      </div>
                    </button>

                    {open && (
                      <div className="mt-3 ml-7 space-y-3">
                        <div className="flex flex-wrap gap-2 text-xs">
                          {meta.lesson_id && (
                            <Link to={`/admin/ops/events?lesson_id=${meta.lesson_id}`} className="inline-flex items-center gap-1 underline text-primary">
                              <ExternalLink className="h-3 w-3" /> Learning-Events (Lesson)
                            </Link>
                          )}
                          {meta.curriculum_id && (
                            <Link to={`/admin/ops/events?curriculum_id=${meta.curriculum_id}`} className="inline-flex items-center gap-1 underline text-primary">
                              <ExternalLink className="h-3 w-3" /> Learning-Events (Curriculum)
                            </Link>
                          )}
                          {meta.content_id && (
                            <a
                              href={`https://supabase.com/dashboard/project/${import.meta.env.VITE_SUPABASE_PROJECT_ID}/storage/buckets/h5p-content`}
                              target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 underline text-primary"
                            >
                              <ExternalLink className="h-3 w-3" /> Storage-Bucket
                            </a>
                          )}
                        </div>

                        {Array.isArray(meta.steps) && meta.steps.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-text-secondary mb-1">Steps</div>
                            <ul className="divide-y divide-border border border-border rounded">
                              {(meta.steps as StepResult[]).map((s, idx) => (
                                <li key={`${r.id}-${idx}`} className="px-3 py-2 flex items-start gap-2">
                                  <div className="mt-0.5">{STATUS_ICON[s.status] ?? STATUS_ICON.skipped}</div>
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs font-medium">{s.label}</div>
                                    {s.detail && <div className="text-[11px] text-text-muted break-all">{s.detail}</div>}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {Array.isArray(meta.healed_actions) && meta.healed_actions.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-text-secondary mb-1">Healed Actions</div>
                            <ul className="text-xs space-y-1">
                              {(meta.healed_actions as HealedAction[]).map((h, i) => (
                                <li key={i} className="flex items-center gap-2">
                                  <Wrench className="h-3 w-3 text-amber-600" />
                                  <code>{h.step}</code> · {h.action}
                                  {h.detail && <span className="text-text-muted"> — {h.detail}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {meta.revalidation && (
                          <div className="text-xs">
                            <span className="font-semibold text-text-secondary">Re-Validation: </span>
                            <code>{JSON.stringify(meta.revalidation)}</code>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
