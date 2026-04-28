/**
 * E2EBundleCheckCard
 * Admin-Card zum Triggern des DB-only E2E-Tests:
 *   admin_e2e_run_bundle_check(p_test_user_id, p_limit)
 *
 * Prüft pro Curriculum:
 *   - Pre-Flight: bundle aktiv, learning_course/exam_trainer inaktiv
 *   - product_price_tiers vorhanden
 *   - grant_learner_course_access funktioniert
 *   - tutor_access_check liefert allowed=true
 *   - Cleanup nach jeder Iteration
 *   - Cleanup-Verification: keine leftover Grants für Test-User
 */
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, PlayCircle, ShieldCheck, AlertTriangle, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type Failure = {
  curriculum_id: string | null;
  slug: string | null;
  step: string;
  error: string;
};

type Assertions = {
  bundle_active: boolean;
  learning_course_inactive: boolean;
  exam_trainer_inactive: boolean;
  only_bundle_active: boolean;
  bundle_id: string | null;
};

type RunResult = {
  ok: boolean;
  phase: 'pre_flight' | 'cleanup_verification' | 'complete';
  assertions: Assertions;
  total?: number;
  passed?: number;
  failed?: number;
  failures?: Failure[];
  cleanup_verified?: boolean;
  leftover_grants?: number;
  cleanup_checked_at?: string;
  test_user_id?: string;
  started_at: string;
  finished_at: string;
};

const DEFAULT_TEST_USER = 'fdb92789-9ce9-40cf-8670-845f04ed267a';

export default function E2EBundleCheckCard() {
  const { toast } = useToast();
  const [limit, setLimit] = useState<string>('5');
  const [offset, setOffset] = useState<string>('0');
  const [testUser, setTestUser] = useState<string>(DEFAULT_TEST_USER);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const parsedLimit = limit.trim() === '' ? null : Number(limit);
      const parsedOffset = offset.trim() === '' ? 0 : Number(offset);
      const { data, error } = await supabase.rpc('admin_e2e_run_bundle_check' as any, {
        p_test_user_id: testUser,
        p_limit: parsedLimit,
        p_offset: parsedOffset,
      });
      if (error) throw error;
      const r = data as RunResult;
      setResult(r);
      toast({
        title: r.ok ? 'E2E-Lauf bestanden' : `E2E-Lauf: ${r.phase}`,
        description: `${r.passed ?? 0}/${r.total ?? 0} pass · cleanup ${
          r.cleanup_verified ? 'OK' : `FAIL (${r.leftover_grants ?? '?'} leftover)`
        }`,
        variant: r.ok ? 'default' : 'destructive',
      });
    } catch (err: any) {
      toast({
        title: 'E2E-Lauf fehlgeschlagen',
        description: err.message ?? String(err),
        variant: 'destructive',
      });
    } finally {
      setRunning(false);
    }
  }

  const passRate =
    result && (result.total ?? 0) > 0
      ? Math.round(((result.passed ?? 0) / (result.total ?? 1)) * 100)
      : null;

  const durationSec = result
    ? (new Date(result.finished_at).getTime() - new Date(result.started_at).getTime()) / 1000
    : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          E2E-Produkttest (Bundle-only · DB-only)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Pre-Flight: <code>bundle</code> aktiv + Legacy inaktiv. Pro Curriculum:{' '}
          <code>product_price_tiers</code> →{' '}
          <code>grant_learner_course_access</code> →{' '}
          <code>tutor_access_check</code> → Cleanup. Final:{' '}
          <strong>Cleanup Verification</strong> stellt sicher, dass keine Test-Grants
          zurückbleiben.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="e2e-limit" className="text-xs">
              Limit (leer = alle 422)
            </Label>
            <Input
              id="e2e-limit"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="z.B. 5, 50, oder leer"
              disabled={running}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="e2e-offset" className="text-xs">
              Start-Offset
            </Label>
            <Input
              id="e2e-offset"
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              placeholder="0"
              disabled={running}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="e2e-user" className="text-xs">
              Test-User-ID
            </Label>
            <Input
              id="e2e-user"
              value={testUser}
              onChange={(e) => setTestUser(e.target.value)}
              disabled={running}
            />
          </div>
        </div>

        <Button onClick={run} disabled={running} size="sm" className="gap-2">
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Läuft…
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4" /> E2E-Lauf starten
            </>
          )}
        </Button>

        {result && (
          <div className="space-y-3">
            {/* Pre-Flight Assertions */}
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className={
                  result.assertions.bundle_active
                    ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
                    : 'bg-destructive/10 text-destructive border-destructive/30'
                }
              >
                bundle active
              </Badge>
              <Badge
                variant="outline"
                className={
                  result.assertions.learning_course_inactive
                    ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
                    : 'bg-destructive/10 text-destructive border-destructive/30'
                }
              >
                learning_course inactive
              </Badge>
              <Badge
                variant="outline"
                className={
                  result.assertions.exam_trainer_inactive
                    ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
                    : 'bg-destructive/10 text-destructive border-destructive/30'
                }
              >
                exam_trainer inactive
              </Badge>
              <Badge
                variant="outline"
                className={
                  result.assertions.only_bundle_active
                    ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
                    : 'bg-destructive/10 text-destructive border-destructive/30'
                }
              >
                only bundle active
              </Badge>
            </div>

            {/* Run summary */}
            {result.phase !== 'pre_flight' && (
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Total: {result.total ?? 0}</Badge>
                <Badge
                  variant="outline"
                  className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
                >
                  Pass: {result.passed ?? 0}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    (result.failed ?? 0) === 0
                      ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
                      : 'bg-destructive/10 text-destructive border-destructive/30'
                  }
                >
                  Fail: {result.failed ?? 0}
                </Badge>
                {passRate !== null && <Badge variant="outline">{passRate}%</Badge>}
                {durationSec !== null && (
                  <Badge variant="outline">{durationSec.toFixed(1)}s</Badge>
                )}
              </div>
            )}

            {/* Cleanup Verification Log */}
            <Alert
              variant={result.cleanup_verified ? 'default' : 'destructive'}
            >
              <Sparkles className="h-4 w-4" />
              <AlertTitle>
                Cleanup Verification:{' '}
                {result.cleanup_verified ? 'OK · keine leftover Grants' : 'FAIL'}
              </AlertTitle>
              <AlertDescription className="text-xs space-y-0.5 mt-1">
                <div>
                  <strong>cleanup_verified:</strong>{' '}
                  {String(result.cleanup_verified ?? false)}
                </div>
                <div>
                  <strong>leftover_grants:</strong> {result.leftover_grants ?? '—'}
                </div>
                <div>
                  <strong>cleanup_checked_at:</strong>{' '}
                  {result.cleanup_checked_at
                    ? new Date(result.cleanup_checked_at).toISOString()
                    : '—'}
                </div>
                <div>
                  <strong>test_user_id:</strong>{' '}
                  <code className="text-[10px]">{result.test_user_id ?? testUser}</code>
                </div>
              </AlertDescription>
            </Alert>

            {/* Phase-specific banner */}
            {result.phase === 'pre_flight' ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Pre-Flight fehlgeschlagen</AlertTitle>
                <AlertDescription>
                  Bundle-only Invariante verletzt. Lauf wurde gar nicht erst gestartet.
                </AlertDescription>
              </Alert>
            ) : (result.failed ?? 0) > 0 ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{result.failed} fehlgeschlagene Schritte</AlertTitle>
                <AlertDescription>
                  Siehe Tabelle. Steps: <code>pricing</code>, <code>grant</code>,{' '}
                  <code>tutor_gate</code>, <code>cleanup_verification</code>,{' '}
                  <code>exception</code>.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Alle Curricula bestanden</AlertTitle>
                <AlertDescription>
                  Bundle-Kaufpfad ist intakt und es bleibt kein Test-Müll zurück.
                </AlertDescription>
              </Alert>
            )}

            {(result.failures?.length ?? 0) > 0 && (
              <div className="border rounded-md max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Slug</TableHead>
                      <TableHead className="text-xs">Step</TableHead>
                      <TableHead className="text-xs">Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.failures!.map((f, i) => (
                      <TableRow key={`${f.curriculum_id ?? 'global'}-${i}`}>
                        <TableCell className="text-xs font-mono">
                          {f.slug ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline">{f.step}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-destructive">
                          {f.error}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
