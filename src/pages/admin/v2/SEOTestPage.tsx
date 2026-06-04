import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Play, ArrowLeft, CheckCircle2, AlertTriangle, XCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  url?: string;
}

interface SuiteResult {
  suite: string;
  passed: number;
  warned: number;
  failed: number;
  checks: CheckResult[];
}

interface ReportData {
  site: string;
  duration_ms: number;
  totals: { passed: number; warned: number; failed: number };
  suites: SuiteResult[];
  generated_at: string;
}

const SUITE_LABELS: Record<string, string> = {
  'html-content': 'HTML-Content (H1, Title, Description)',
  'canonical': 'Canonical-Tags',
  'sitemap-robots': 'Sitemap & Robots.txt',
  'trailing-slash': 'Trailing-Slash-Verhalten',
};

function StatusIcon({ s }: { s: CheckResult['status'] }) {
  if (s === 'pass') return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (s === 'warn') return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <XCircle className="h-4 w-4 text-destructive" />;
}

function StatusBadge({ s }: { s: CheckResult['status'] }) {
  const map = {
    pass: { label: 'PASS', cls: 'border-success/40 text-success' },
    warn: { label: 'WARN', cls: 'border-warning/40 text-warning' },
    fail: { label: 'FAIL', cls: 'border-destructive/40 text-destructive' },
  } as const;
  return <Badge variant="outline" className={map[s].cls}>{map[s].label}</Badge>;
}

export default function SEOTestPage() {
  const [report, setReport] = useState<ReportData | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const runTests = async (suite?: string) => {
    setRunning(suite || 'all');
    try {
      const { data, error } = await supabase.functions.invoke('seo-self-test', {
        method: 'GET',
        body: undefined,
        ...(suite ? { headers: { 'x-suite': suite } } : {}),
      });
      // invoke does GET via query param trick — use fetch fallback
      if (error) throw error;
      setReport(data as ReportData);
      toast.success(`Tests fertig: ${(data as ReportData).totals.passed} pass / ${(data as ReportData).totals.failed} fail`);
    } catch (err) {
      // Fallback: direct fetch with query param
      try {
        const url = new URL(`https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/seo-self-test`);
        if (suite) url.searchParams.set('suite', suite);
        const res = await fetch(url.toString());
        const data = await res.json();
        setReport(data as ReportData);
        toast.success(`Tests fertig: ${data.totals.passed} pass / ${data.totals.failed} fail`);
      } catch (e2) {
        toast.error(`Test-Run fehlgeschlagen: ${(e2 as Error).message}`);
      }
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to="/admin/command"><ArrowLeft className="h-4 w-4 mr-2" />Zurück</Link>
          </Button>
          <h1 className="text-3xl font-bold">SEO Self-Test</h1>
          <p className="text-muted-foreground mt-1">
            Live-Tests gegen <code className="text-xs bg-muted px-1.5 py-0.5 rounded">berufos.com</code> — HTML, Canonical, Sitemap, Trailing-Slash.
          </p>
        </div>
        <Button onClick={() => runTests()} disabled={!!running} size="lg">
          {running === 'all' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          Alle Tests ausführen
        </Button>
      </div>

      {/* Per-Suite Quick Run */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Einzelne Suiten</CardTitle>
          <CardDescription>Nur eine Suite laufen lassen (schneller).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.entries(SUITE_LABELS).map(([k, label]) => (
            <Button key={k} variant="outline" size="sm" onClick={() => runTests(k)} disabled={!!running}>
              {running === k ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-2" />}
              {label}
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* Summary */}
      {report && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Zusammenfassung</span>
              <span className="text-xs font-normal text-muted-foreground">
                {report.duration_ms} ms · {new Date(report.generated_at).toLocaleString('de-DE')}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-success/30 bg-success-bg-subtle p-4">
                <div className="text-3xl font-bold text-success">{report.totals.passed}</div>
                <div className="text-xs text-muted-foreground mt-1">Passed</div>
              </div>
              <div className="rounded-lg border border-warning/30 bg-warning-bg-subtle p-4">
                <div className="text-3xl font-bold text-warning">{report.totals.warned}</div>
                <div className="text-xs text-muted-foreground mt-1">Warnings</div>
              </div>
              <div className="rounded-lg border border-destructive/30 bg-destructive-bg-subtle p-4">
                <div className="text-3xl font-bold text-destructive">{report.totals.failed}</div>
                <div className="text-xs text-muted-foreground mt-1">Failed</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Suites Detail */}
      {report?.suites.map((suite) => (
        <Card key={suite.suite}>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>{SUITE_LABELS[suite.suite] || suite.suite}</span>
              <div className="flex gap-2 text-xs font-normal">
                <span className="text-success">{suite.passed} pass</span>
                {suite.warned > 0 && <span className="text-warning">{suite.warned} warn</span>}
                {suite.failed > 0 && <span className="text-destructive">{suite.failed} fail</span>}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-1">
                {suite.checks.map((c, i) => (
                  <div key={i} className="flex items-start gap-3 py-2 px-3 rounded hover:bg-muted/40 text-sm">
                    <StatusIcon s={c.status} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{c.name}</span>
                        <StatusBadge s={c.status} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 break-words">{c.detail}</div>
                      {c.url && (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1"
                        >
                          {c.url} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      ))}

      {!report && !running && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Noch keine Tests ausgeführt. Klicke oben auf <strong>"Alle Tests ausführen"</strong>.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
