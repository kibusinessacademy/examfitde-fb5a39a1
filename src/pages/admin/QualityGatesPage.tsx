import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { 
  ShieldCheck, 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  Clock,
  Play,
  Eye,
  FileCheck,
  Loader2,
  RefreshCw,
  BarChart3
} from 'lucide-react';
import { toast } from 'sonner';

interface QualityCheck {
  id: string;
  curriculum_product_id: string;
  check_type: string;
  status: string;
  score: number | null;
  details: unknown;
  executed_at: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
}

interface CurriculumProductWithChecks {
  id: string;
  curriculum_id: string;
  curriculum_title: string;
  product_name: string;
  product_key: string;
  generation_status: string;
  is_published: boolean;
  quality_checks: QualityCheck[];
}

const CHECK_CONFIG = {
  coverage: {
    label: 'Abdeckung',
    description: 'Prüft ob alle Kompetenzen des Curriculums abgedeckt sind',
    icon: BarChart3,
    color: 'text-blue-500',
  },
  duplicate: {
    label: 'Duplikate',
    description: 'Erkennt doppelte oder sehr ähnliche Fragen',
    icon: FileCheck,
    color: 'text-purple-500',
  },
  correctness: {
    label: 'Korrektheit',
    description: 'Prüft ob jede Frage min. 1 und max. 2 korrekte Antworten hat',
    icon: CheckCircle,
    color: 'text-green-500',
  },
  difficulty_distribution: {
    label: 'Schwierigkeitsverteilung',
    description: 'Prüft ob die Verteilung leicht/mittel/schwer stimmt',
    icon: BarChart3,
    color: 'text-orange-500',
  },
};

const STATUS_CONFIG = {
  pending: { label: 'Ausstehend', color: 'bg-muted', icon: Clock },
  running: { label: 'Läuft...', color: 'bg-yellow-500/20 text-yellow-600', icon: Loader2 },
  passed: { label: 'Bestanden', color: 'bg-green-500/20 text-green-600', icon: CheckCircle },
  failed: { label: 'Fehlgeschlagen', color: 'bg-destructive/20 text-destructive', icon: XCircle },
  warning: { label: 'Warnung', color: 'bg-orange-500/20 text-orange-600', icon: AlertTriangle },
};

export default function QualityGatesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedCheck, setSelectedCheck] = useState<QualityCheck | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  // Fetch curriculum products with their quality checks
  const { data: products, isLoading, refetch } = useQuery({
    queryKey: ['quality-gates-overview'],
    queryFn: async () => {
      // First get curriculum products
      const { data: cpData, error: cpError } = await supabase
        .from('curriculum_products_overview')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (cpError) throw cpError;

      // Then get quality checks for each
      const productsWithChecks: CurriculumProductWithChecks[] = [];
      
      for (const cp of cpData || []) {
        const { data: checks, error: checksError } = await supabase
          .from('quality_checks')
          .select('*')
          .eq('curriculum_product_id', cp.id)
          .order('check_type');
        
        if (checksError) throw checksError;

        productsWithChecks.push({
          id: cp.id,
          curriculum_id: cp.curriculum_id,
          curriculum_title: cp.curriculum_title,
          product_name: cp.product_name,
          product_key: cp.product_key,
          generation_status: cp.generation_status,
          is_published: cp.is_published,
          quality_checks: checks || [],
        });
      }

      return productsWithChecks;
    },
  });

  // Run a quality check via Edge Function
  const runCheckMutation = useMutation({
    mutationFn: async ({ checkId, checkType, cpId }: { checkId: string; checkType: string; cpId: string }) => {
      // Call the quality check Edge Function
      const { data, error } = await supabase.functions.invoke('run-quality-checks', {
        body: {
          checkId,
          checkType,
          curriculumProductId: cpId,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return { 
        status: data.status, 
        score: data.score, 
        details: data.details 
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality-gates-overview'] });
      toast.success('Check abgeschlossen');
    },
    onError: (error) => {
      toast.error('Check fehlgeschlagen', { description: String(error) });
    },
  });

  // Run all checks for a product
  const runAllChecksMutation = useMutation({
    mutationFn: async (productId: string) => {
      const product = products?.find(p => p.id === productId);
      if (!product) throw new Error('Product not found');

      for (const check of product.quality_checks) {
        await runCheckMutation.mutateAsync({
          checkId: check.id,
          checkType: check.check_type,
          cpId: product.curriculum_id,
        });
      }
    },
    onSuccess: () => {
      toast.success('Alle Checks abgeschlossen');
    },
  });

  // Submit review
  const submitReviewMutation = useMutation({
    mutationFn: async ({ checkId, notes }: { checkId: string; notes: string }) => {
      const { error } = await supabase
        .from('quality_checks')
        .update({
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id,
          review_notes: notes,
        })
        .eq('id', checkId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality-gates-overview'] });
      setSelectedCheck(null);
      setReviewNotes('');
      toast.success('Review gespeichert');
    },
  });

  // Calculate overall stats
  const stats = products?.reduce((acc, p) => {
    p.quality_checks.forEach(qc => {
      acc.total++;
      if (qc.status === 'passed') acc.passed++;
      if (qc.status === 'failed') acc.failed++;
      if (qc.status === 'warning') acc.warning++;
      if (qc.status === 'pending') acc.pending++;
    });
    return acc;
  }, { total: 0, passed: 0, failed: 0, warning: 0, pending: 0 }) || { total: 0, passed: 0, failed: 0, warning: 0, pending: 0 };

  const passRate = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Quality Gates
          </h1>
          <p className="text-muted-foreground">
            Automatisierte Qualitätskontrollen vor der Veröffentlichung
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Aktualisieren
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-foreground">{stats.total}</div>
            <p className="text-sm text-muted-foreground">Gesamt Checks</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-green-500/30">
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-green-600">{stats.passed}</div>
            <p className="text-sm text-muted-foreground">Bestanden</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-orange-500/30">
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-orange-600">{stats.warning}</div>
            <p className="text-sm text-muted-foreground">Warnungen</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-destructive/30">
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-destructive">{stats.failed}</div>
            <p className="text-sm text-muted-foreground">Fehlgeschlagen</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-foreground">{passRate}%</div>
            <p className="text-sm text-muted-foreground">Erfolgsrate</p>
            <Progress value={passRate} className="h-1 mt-2" />
          </CardContent>
        </Card>
      </div>

      {/* Check Types Legend */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Check-Typen</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(CHECK_CONFIG).map(([key, config]) => {
              const Icon = config.icon;
              return (
                <div key={key} className="flex items-start gap-2">
                  <Icon className={`h-5 w-5 mt-0.5 ${config.color}`} />
                  <div>
                    <p className="font-medium text-sm">{config.label}</p>
                    <p className="text-xs text-muted-foreground">{config.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Products with Quality Checks */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Produkt-Qualitätsstatus</CardTitle>
          <CardDescription>
            Übersicht aller Qualitätsprüfungen pro Curriculum-Produkt
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !products?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <ShieldCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Keine Produkte mit Quality Gates gefunden.</p>
            </div>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {products.map((product) => {
                const allPassed = product.quality_checks.every(qc => qc.status === 'passed');
                const hasFailed = product.quality_checks.some(qc => qc.status === 'failed');
                const hasWarning = product.quality_checks.some(qc => qc.status === 'warning');

                return (
                  <AccordionItem key={product.id} value={product.id}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-4 w-full pr-4">
                        <div className="flex-1 text-left">
                          <p className="font-medium">{product.curriculum_title}</p>
                          <p className="text-sm text-muted-foreground">{product.product_name}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {allPassed && (
                            <Badge className="bg-green-500/20 text-green-600 gap-1">
                              <CheckCircle className="h-3 w-3" />
                              Alle bestanden
                            </Badge>
                          )}
                          {hasFailed && (
                            <Badge className="bg-destructive/20 text-destructive gap-1">
                              <XCircle className="h-3 w-3" />
                              Fehler
                            </Badge>
                          )}
                          {hasWarning && !hasFailed && !allPassed && (
                            <Badge className="bg-orange-500/20 text-orange-600 gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Warnungen
                            </Badge>
                          )}
                          {product.is_published && (
                            <Badge variant="outline" className="text-green-600">Live</Badge>
                          )}
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="pt-4 space-y-4">
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => runAllChecksMutation.mutate(product.id)}
                            disabled={runAllChecksMutation.isPending}
                          >
                            {runAllChecksMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <Play className="h-4 w-4 mr-2" />
                            )}
                            Alle Checks ausführen
                          </Button>
                        </div>

                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Check</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Score</TableHead>
                              <TableHead>Zuletzt ausgeführt</TableHead>
                              <TableHead>Review</TableHead>
                              <TableHead></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {product.quality_checks.map((check) => {
                              const checkConfig = CHECK_CONFIG[check.check_type as keyof typeof CHECK_CONFIG];
                              const statusConfig = STATUS_CONFIG[check.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending;
                              const StatusIcon = statusConfig.icon;
                              const CheckIcon = checkConfig?.icon || ShieldCheck;

                              return (
                                <TableRow key={check.id}>
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <CheckIcon className={`h-4 w-4 ${checkConfig?.color || 'text-muted-foreground'}`} />
                                      {checkConfig?.label || check.check_type}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Badge className={`gap-1 ${statusConfig.color}`}>
                                      <StatusIcon className={`h-3 w-3 ${check.status === 'running' ? 'animate-spin' : ''}`} />
                                      {statusConfig.label}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    {check.score !== null ? (
                                      <span className={`font-mono ${
                                        check.score >= 90 ? 'text-green-600' :
                                        check.score >= 70 ? 'text-orange-600' :
                                        'text-destructive'
                                      }`}>
                                        {check.score}%
                                      </span>
                                    ) : '-'}
                                  </TableCell>
                                  <TableCell className="text-muted-foreground text-sm">
                                    {check.executed_at 
                                      ? new Date(check.executed_at).toLocaleString('de-DE')
                                      : '-'
                                    }
                                  </TableCell>
                                  <TableCell>
                                    {check.reviewed_at ? (
                                      <Badge variant="outline" className="gap-1">
                                        <CheckCircle className="h-3 w-3" />
                                        Reviewed
                                      </Badge>
                                    ) : check.status !== 'pending' && check.status !== 'running' ? (
                                      <Badge variant="secondary">Offen</Badge>
                                    ) : '-'}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-1">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => runCheckMutation.mutate({
                                          checkId: check.id,
                                          checkType: check.check_type,
                                          cpId: product.curriculum_id,
                                        })}
                                        disabled={runCheckMutation.isPending}
                                      >
                                        <Play className="h-4 w-4" />
                                      </Button>
                                      {check.details && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => {
                                            setSelectedCheck(check);
                                            setReviewNotes(check.review_notes || '');
                                          }}
                                        >
                                          <Eye className="h-4 w-4" />
                                        </Button>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>

      {/* Check Details Dialog */}
      <Dialog open={!!selectedCheck} onOpenChange={(open) => !open && setSelectedCheck(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Check Details: {selectedCheck && CHECK_CONFIG[selectedCheck.check_type as keyof typeof CHECK_CONFIG]?.label}
            </DialogTitle>
            <DialogDescription>
              Detaillierte Ergebnisse und Admin-Review
            </DialogDescription>
          </DialogHeader>
          
          {selectedCheck && (
            <div className="space-y-4">
              {/* Results */}
              <div className="p-4 rounded-lg bg-muted/30 border border-border">
                <h4 className="font-medium mb-2">Ergebnisse</h4>
                <pre className="text-sm overflow-auto max-h-48">
                  {JSON.stringify(selectedCheck.details, null, 2)}
                </pre>
              </div>

              {/* Score */}
              {selectedCheck.score !== null && (
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium">Score:</span>
                  <div className="flex-1">
                    <Progress value={selectedCheck.score} className="h-2" />
                  </div>
                  <span className={`font-mono font-bold ${
                    selectedCheck.score >= 90 ? 'text-green-600' :
                    selectedCheck.score >= 70 ? 'text-orange-600' :
                    'text-destructive'
                  }`}>
                    {selectedCheck.score}%
                  </span>
                </div>
              )}

              {/* Admin Notes */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Admin-Notizen</label>
                <Textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Notizen zur Prüfung hinzufügen..."
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedCheck(null)}>
              Abbrechen
            </Button>
            <Button 
              onClick={() => selectedCheck && submitReviewMutation.mutate({
                checkId: selectedCheck.id,
                notes: reviewNotes,
              })}
              disabled={submitReviewMutation.isPending}
            >
              {submitReviewMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Review speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
