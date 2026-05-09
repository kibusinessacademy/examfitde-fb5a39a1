import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, MinusCircle, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';

interface StepResult {
  key: string;
  label: string;
  status: 'ok' | 'fail' | 'skipped';
  detail?: string;
  data?: unknown;
}
interface SmokeResult {
  ok: boolean;
  overall: 'green' | 'yellow' | 'red';
  summary: { ok: number; fail: number; total: number };
  steps: StepResult[];
}

const STATUS_ICON = {
  ok: <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="ok" />,
  fail: <XCircle className="h-4 w-4 text-destructive" aria-label="fail" />,
  skipped: <MinusCircle className="h-4 w-4 text-text-muted" aria-label="skipped" />,
} as const;

const OVERALL_BADGE: Record<SmokeResult['overall'], string> = {
  green: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  yellow: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  red: 'bg-destructive/15 text-destructive border-destructive/30',
};

export default function AdminH5PSmokePage() {
  const [contentId, setContentId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [curriculumId, setCurriculumId] = useState('');
  const [score, setScore] = useState<number>(85);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SmokeResult | null>(null);

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
        },
      });
      if (error) throw error;
      setResult(data as SmokeResult);
      const r = data as SmokeResult;
      if (r.overall === 'green') toast.success('Alle Schritte grün');
      else if (r.overall === 'yellow') toast.warning('Teilweise erfolgreich');
      else toast.error('Smoke fehlgeschlagen');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Smoke-Run fehlgeschlagen');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">H5P End-to-End Smoke</h1>
        <p className="text-sm text-text-secondary mt-1">
          Verifiziert nach einem Upload die komplette Pipeline: Storage-Objekt, Lesson-Verlinkung,
          <code> update_lesson_outcome</code>, <code>h5p_completed</code> Event und den
          Exam-Readiness Snapshot.
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
            <Input id="lid" value={lessonId} onChange={(e) => setLessonId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
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
          <Button onClick={run} disabled={running} className="w-full sm:w-auto">
            {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Läuft…</> : <><Play className="h-4 w-4 mr-2" /> Smoke starten</>}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Ergebnis</CardTitle>
              <span className={`text-xs font-medium px-2 py-1 rounded-md border ${OVERALL_BADGE[result.overall]}`}>
                {result.overall.toUpperCase()} — {result.summary.ok}/{result.summary.total} ok
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {result.steps.map((s) => (
                <li key={s.key} className="py-3 flex items-start gap-3">
                  <div className="mt-0.5">{STATUS_ICON[s.status]}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text-primary">{s.label}</div>
                    {s.detail && <div className="text-xs text-text-muted break-all">{s.detail}</div>}
                    {s.data !== undefined && s.data !== null && (
                      <pre className="mt-1 text-xs bg-status-bg-subtle border border-border rounded p-2 overflow-x-auto">
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
    </div>
  );
}
