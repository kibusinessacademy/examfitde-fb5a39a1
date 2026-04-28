/**
 * E2EBundleCheckCard
 * Admin-Card zum Triggern des DB-only E2E-Tests:
 *   admin_e2e_run_bundle_check(p_test_user_id, p_limit)
 *
 * Prüft für alle (oder limitierten Subset) frozen Curricula:
 *   - bundle product aktiv + price tier vorhanden
 *   - grant_learner_course_access funktioniert
 *   - tutor_access_check liefert allowed=true
 *   - Cleanup nach jeder Iteration
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
import { Loader2, PlayCircle, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type Failure = {
  curriculum_id: string;
  slug: string;
  step: string;
  error: string;
};

type RunResult = {
  started_at: string;
  finished_at: string;
  duration_sec: number;
  bundle_product_id: string;
  price_tier_count: number;
  total_curricula: number;
  passed: number;
  failed: number;
  failures: Failure[];
};

const DEFAULT_TEST_USER = 'fdb92789-9ce9-40cf-8670-845f04ed267a';

export default function E2EBundleCheckCard() {
  const { toast } = useToast();
  const [limit, setLimit] = useState<string>('5');
  const [testUser, setTestUser] = useState<string>(DEFAULT_TEST_USER);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const parsedLimit = limit.trim() === '' ? null : Number(limit);
      const { data, error } = await supabase.rpc('admin_e2e_run_bundle_check' as any, {
        p_test_user_id: testUser,
        p_limit: parsedLimit,
      });
      if (error) throw error;
      setResult(data as RunResult);
      toast({
        title: 'E2E-Lauf abgeschlossen',
        description: `${(data as RunResult).passed}/${(data as RunResult).total_curricula} bestanden`,
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

  const passRate = result && result.total_curricula > 0
    ? Math.round((result.passed / result.total_curricula) * 100)
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
          Validiert pro Curriculum: <code>store_products[bundle]</code> aktiv +{' '}
          <code>product_price_tiers</code> vorhanden →{' '}
          <code>grant_learner_course_access</code> →{' '}
          <code>tutor_access_check</code> → Cleanup. Kein Stripe-Aufruf.
          <br />
          Hinweis: <strong>learning_course</strong> und <strong>exam_trainer</strong> sind
          deaktiviert (Pricing-Strategie 24,90&nbsp;€ Bundle-only).
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
          <div className="space-y-1 md:col-span-2">
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
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Total: {result.total_curricula}</Badge>
              <Badge variant="outline" className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">
                Pass: {result.passed}
              </Badge>
              <Badge
                variant="outline"
                className={
                  result.failed === 0
                    ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
                    : 'bg-destructive/10 text-destructive border-destructive/30'
                }
              >
                Fail: {result.failed}
              </Badge>
              {passRate !== null && (
                <Badge variant="outline">Pass-Rate: {passRate}%</Badge>
              )}
              <Badge variant="outline">{result.duration_sec.toFixed(1)}s</Badge>
              <Badge variant="outline">{result.price_tier_count} price tiers</Badge>
            </div>

            {result.failed > 0 ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{result.failed} fehlgeschlagene Curricula</AlertTitle>
                <AlertDescription>
                  Siehe Tabelle unten. Häufige Step-Werte: <code>grant</code>,{' '}
                  <code>tutor_gate</code>, <code>cleanup</code>.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Alle Curricula bestanden</AlertTitle>
                <AlertDescription>
                  Bundle-Kaufpfad ist für alle getesteten Lehrpläne intakt.
                </AlertDescription>
              </Alert>
            )}

            {result.failures.length > 0 && (
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
                    {result.failures.map((f) => (
                      <TableRow key={f.curriculum_id}>
                        <TableCell className="text-xs font-mono">{f.slug}</TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline">{f.step}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-destructive">{f.error}</TableCell>
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
