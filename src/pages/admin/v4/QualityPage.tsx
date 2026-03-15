import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCanonicalTitles, resolveTitle } from '@/hooks/useCanonicalTitles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Shield, CheckCircle2, XCircle, AlertTriangle, FileText, Lock } from 'lucide-react';
import PageExplainer from '@/components/admin/PageExplainer';

const ComplianceDashboardPage = lazy(() => import('@/pages/admin/ComplianceDashboardPage'));
const AZAVCompliancePage = lazy(() => import('@/pages/admin/AZAVCompliancePage'));
const ManualLessonEditor = lazy(() => import('@/components/admin/ManualLessonEditor'));
const EliteMatrixPage = lazy(() => import('@/pages/admin/EliteMatrixPage'));
const CoverageGapsPage = lazy(() => import('@/pages/admin/v4/CoverageGapsPage'));

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const QualityShieldDashboard = lazy(() => import('@/components/admin/QualityShieldDashboard'));

const tabs = [
  { path: '/admin/quality', label: 'Übersicht' },
  { path: '/admin/quality/elite-matrix', label: 'Elite-Matrix' },
  { path: '/admin/quality/coverage', label: 'Coverage Gaps' },
  { path: '/admin/quality/shield', label: 'Quality Shield' },
  { path: '/admin/quality/integrity', label: 'Integrität' },
  { path: '/admin/quality/repair', label: 'Nachbearbeitung' },
  { path: '/admin/quality/compliance', label: 'Compliance' },
  { path: '/admin/quality/azav', label: 'AZAV/ISO' },
];

/* ── Integrity Overview ── */
function IntegrityOverview() {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('course_packages')
        .select('id, title, status, integrity_passed, integrity_report')
        .neq('status', 'planning')
        .neq('status', 'archived')
        .order('created_at', { ascending: false });
      setPackages(data || []);
      setLoading(false);
    })();
  }, []);

  const { data: canonicalTitles } = useCanonicalTitles(packages.map((p: any) => p.id));

  if (loading) return <Loading />;

  const failed = packages.filter(p => !p.integrity_passed && p.status !== 'published');
  const passed = packages.filter(p => p.integrity_passed);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Bestanden</p>
            <p className="text-2xl font-bold text-success">{passed.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Blockiert</p>
            <p className="text-2xl font-bold text-destructive">{failed.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Gesamt</p>
            <p className="text-2xl font-bold text-foreground">{packages.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-2">
        {packages.map(pkg => {
          const report = pkg.integrity_report || {};
          const score = report.score ?? (pkg.integrity_passed ? 100 : 0);
          return (
            <Card key={pkg.id} className={cn("border-l-4",
              pkg.integrity_passed ? 'border-l-success' : 'border-l-destructive'
            )}>
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {pkg.integrity_passed ?
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> :
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  }
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{resolveTitle(canonicalTitles, pkg.id, pkg.title)}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={score} className="h-1.5 max-w-32" />
                      <span className={cn("text-xs font-mono",
                        score >= 80 ? 'text-success' : score >= 60 ? 'text-warning' : 'text-destructive'
                      )}>{score}/100</span>
                    </div>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs">{pkg.status}</Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ── Security Health Card ── */
function SecurityHealthCard() {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).rpc('security_health_summary');
      setHealth(data);
    })();
  }, []);

  if (!health) return null;

  const noRls = health.tables_without_rls ?? 0;
  const permissive = health.permissive_policies ?? 0;
  const isGood = noRls === 0 && permissive === 0;

  return (
    <Card className={cn("border-l-4", isGood ? 'border-l-success' : 'border-l-destructive')}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="h-4 w-4" /> Security Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-3 rounded-lg bg-muted/30">
            <p className={cn("text-xl font-bold", noRls > 0 ? 'text-destructive' : 'text-success')}>{noRls}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Tabellen ohne RLS</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/30">
            <p className={cn("text-xl font-bold", permissive > 0 ? 'text-warning' : 'text-success')}>{permissive}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Permissive Policies</p>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Geprüft: {new Date(health.checked_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}
        </p>
      </CardContent>
    </Card>
  );
}

/* ── Quality Overview ── */
function QualityOverview() {
  return (
    <div className="space-y-6">
      {/* Security Health */}
      <SecurityHealthCard />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link to="/admin/quality/integrity">
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" /> Integrität
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Soll-Ist-Abgleich aller Kurspakete, Score-Verlauf und blockierte Publishes.</p>
            </CardContent>
          </Card>
        </Link>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lock className="h-4 w-4 text-warning" /> RLS Audit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Tabellen ohne Policy, permissive Policies, Admin-only Hinweise. Automatische Prüfung.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> DSGVO
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">User Data Export/Delete, Datenklassifizierung. Nur über Admin-RPCs zugänglich.</p>
          </CardContent>
        </Card>
        <Link to="/admin/quality/azav">
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4 text-success" /> AZAV/ISO
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Checklisten, timestamped Validierung, Evidence Packs, PDF-Export.</p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}

export default function QualityPage() {
  const location = useLocation();
  const activeTab = tabs.find(t => location.pathname === t.path)?.path ||
    tabs.find(t => location.pathname.startsWith(t.path) && t.path !== '/admin/quality')?.path ||
    tabs[0].path;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Qualität & Compliance</h1>
        <p className="text-sm text-muted-foreground">Integrität, RLS Audit, DSGVO, AZAV/ISO</p>
      </div>

      <PageExplainer
        title="Wie funktioniert Qualität & Compliance?"
        description="Hier prüfst du die Qualität aller Kurspakete und stellst Compliance sicher. Der Integritäts-Check vergleicht Soll vs. Ist jedes Pakets (Lektionen, Fragen, Szenarien). AZAV/ISO liefert Audit-Checklisten für die Zertifizierung."
        workflow={[
          { label: 'Leitstelle' },
          { label: 'Studio' },
          { label: 'Quality', active: true },
          { label: 'Ops' },
          { label: 'Business' },
          { label: 'Growth' },
          { label: 'Scale' },
        ]}
        actions={[
          '"Übersicht" – Security Health + Links zu allen Qualitäts-Bereichen',
          '"Integrität" – Score pro Paket, blockierte Publishes erkennen',
          '"Compliance" – DSGVO-Übersicht und Datenklassifizierung',
          '"AZAV/ISO" – Audit-Checklisten, Evidence Packs, PDF-Export',
        ]}
        tips={[
          'Ein Paket kann nur veröffentlicht werden, wenn der Integrity-Score ≥ 80 ist',
          'Die Security Health Card zeigt RLS-Probleme in Echtzeit',
          'AZAV Evidence Packs werden automatisch bei Qualitätsänderungen aktualisiert',
        ]}
      />

      <div className="overflow-x-auto">
        <div className="flex gap-1 border-b border-border pb-px min-w-max">
          {tabs.map(tab => (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "px-3 py-2 text-sm rounded-t-md transition-colors",
                activeTab === tab.path
                  ? "bg-primary/10 text-primary font-medium border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<QualityOverview />} />
          <Route path="elite-matrix" element={<EliteMatrixPage />} />
          <Route path="coverage" element={<CoverageGapsPage />} />
          <Route path="shield" element={<QualityShieldDashboard />} />
          <Route path="integrity" element={<IntegrityOverview />} />
          <Route path="repair" element={<ManualLessonEditor />} />
          <Route path="compliance" element={<ComplianceDashboardPage />} />
          <Route path="azav" element={<AZAVCompliancePage />} />
        </Routes>
      </Suspense>
    </div>
  );
}
