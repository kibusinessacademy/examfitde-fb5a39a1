import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { 
  Bot, 
  Activity, 
  AlertTriangle, 
  DollarSign, 
  Zap, 
  Clock, 
  RefreshCw,
  Settings,
  Play,
  Pause,
  Loader2,
  TrendingUp,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

interface WorkerHealth {
  job_type: string;
  enabled: boolean;
  max_parallel: number;
  max_attempts: number;
  timeout_seconds: number;
  max_tokens_per_run: number;
  max_cost_eur_per_day: number;
  pause_on_error_rate: number;
  runs_today: number;
  errors_today: number;
  tokens_today: number;
  cost_today: number;
  error_rate: number;
  status: 'active' | 'disabled' | 'paused_budget' | 'paused_error_rate';
  policy_updated_at: string;
}

interface WorkerPolicy {
  job_type: string;
  max_parallel: number;
  max_attempts: number;
  timeout_seconds: number;
  max_tokens_per_run: number;
  max_cost_eur_per_day: number;
  pause_on_error_rate: number;
  enabled: boolean;
}

const statusConfig = {
  active: { label: 'Aktiv', variant: 'default' as const, icon: Play, color: 'text-green-500' },
  disabled: { label: 'Deaktiviert', variant: 'secondary' as const, icon: Pause, color: 'text-muted-foreground' },
  paused_budget: { label: 'Budget erschöpft', variant: 'destructive' as const, icon: DollarSign, color: 'text-destructive' },
  paused_error_rate: { label: 'Fehlerrate zu hoch', variant: 'destructive' as const, icon: AlertTriangle, color: 'text-destructive' },
};

export default function AIWorkersPage() {
  const queryClient = useQueryClient();
  const [editingPolicy, setEditingPolicy] = useState<WorkerPolicy | null>(null);
  const [formData, setFormData] = useState<Partial<WorkerPolicy>>({});

  // Fetch worker health data
  const { data: workers, isLoading, refetch } = useQuery({
    queryKey: ['ai-worker-health'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_worker_health')
        .select('*')
        .order('job_type');
      
      if (error) throw error;
      return data as WorkerHealth[];
    },
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  });

  // Toggle worker enabled/disabled
  const toggleMutation = useMutation({
    mutationFn: async ({ jobType, enabled }: { jobType: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('ai_worker_policies')
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq('job_type', jobType);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-worker-health'] });
      toast.success('Worker-Status aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren', { description: String(error) });
    },
  });

  // Update policy
  const updatePolicyMutation = useMutation({
    mutationFn: async (policy: Partial<WorkerPolicy> & { job_type: string }) => {
      const { job_type, ...updates } = policy;
      const { error } = await supabase
        .from('ai_worker_policies')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('job_type', job_type);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-worker-health'] });
      setEditingPolicy(null);
      toast.success('Policy aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Speichern', { description: String(error) });
    },
  });

  // Resume paused worker
  const resumeWorker = async (jobType: string) => {
    toggleMutation.mutate({ jobType, enabled: true });
  };

  const openEditDialog = (worker: WorkerHealth) => {
    setEditingPolicy({
      job_type: worker.job_type,
      max_parallel: worker.max_parallel,
      max_attempts: worker.max_attempts,
      timeout_seconds: worker.timeout_seconds,
      max_tokens_per_run: worker.max_tokens_per_run,
      max_cost_eur_per_day: worker.max_cost_eur_per_day,
      pause_on_error_rate: worker.pause_on_error_rate,
      enabled: worker.enabled,
    });
    setFormData({
      max_parallel: worker.max_parallel,
      max_attempts: worker.max_attempts,
      timeout_seconds: worker.timeout_seconds,
      max_tokens_per_run: worker.max_tokens_per_run,
      max_cost_eur_per_day: worker.max_cost_eur_per_day,
      pause_on_error_rate: worker.pause_on_error_rate,
    });
  };

  const handleSavePolicy = () => {
    if (!editingPolicy) return;
    updatePolicyMutation.mutate({
      job_type: editingPolicy.job_type,
      ...formData,
    });
  };

  // Calculate totals
  const totals = workers?.reduce(
    (acc, w) => ({
      runs: acc.runs + (w.runs_today || 0),
      errors: acc.errors + (w.errors_today || 0),
      tokens: acc.tokens + (w.tokens_today || 0),
      cost: acc.cost + (w.cost_today || 0),
    }),
    { runs: 0, errors: 0, tokens: 0, cost: 0 }
  ) || { runs: 0, errors: 0, tokens: 0, cost: 0 };

  const activeWorkers = workers?.filter(w => w.status === 'active').length || 0;
  const pausedWorkers = workers?.filter(w => w.status.startsWith('paused')).length || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">AI Worker Governance</h1>
          <p className="text-muted-foreground">
            Überwache und steuere alle KI-Worker mit Budgets und Limits
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Aktualisieren
        </Button>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Aktive Worker</CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeWorkers}</div>
            <p className="text-xs text-muted-foreground">
              {pausedWorkers > 0 && (
                <span className="text-destructive">{pausedWorkers} pausiert</span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Runs heute</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.runs}</div>
            <p className="text-xs text-muted-foreground">
              {totals.errors > 0 && (
                <span className="text-destructive">{totals.errors} Fehler</span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Tokens heute</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(totals.tokens / 1000).toFixed(1)}k</div>
            <p className="text-xs text-muted-foreground">
              ~{(totals.tokens / totals.runs || 0).toFixed(0)} pro Run
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Kosten heute</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">€{totals.cost.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              ~€{(totals.cost / totals.runs || 0).toFixed(3)} pro Run
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Worker Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Worker Policies</CardTitle>
          <CardDescription>
            Konfiguriere Limits und Budgets für jeden Job-Typ
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job-Typ</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Heute</TableHead>
                <TableHead className="text-right">Fehlerrate</TableHead>
                <TableHead className="text-right">Kosten</TableHead>
                <TableHead className="text-right">Limit</TableHead>
                <TableHead>Aktiv</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers?.map((worker) => {
                const config = statusConfig[worker.status];
                const StatusIcon = config.icon;
                
                return (
                  <TableRow key={worker.job_type}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-muted-foreground" />
                        {worker.job_type}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={config.variant} className="gap-1">
                        <StatusIcon className="h-3 w-3" />
                        {config.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <TrendingUp className="h-3 w-3 text-muted-foreground" />
                        {worker.runs_today} runs
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={worker.error_rate >= worker.pause_on_error_rate ? 'text-destructive font-medium' : ''}>
                        {(worker.error_rate * 100).toFixed(0)}%
                      </span>
                      <span className="text-muted-foreground text-xs ml-1">
                        / {(worker.pause_on_error_rate * 100).toFixed(0)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={worker.cost_today >= worker.max_cost_eur_per_day ? 'text-destructive font-medium' : ''}>
                        €{worker.cost_today.toFixed(2)}
                      </span>
                      <span className="text-muted-foreground text-xs ml-1">
                        / €{worker.max_cost_eur_per_day.toFixed(0)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1 text-muted-foreground text-sm">
                        <Clock className="h-3 w-3" />
                        {worker.timeout_seconds}s
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={worker.enabled}
                        onCheckedChange={(checked) => 
                          toggleMutation.mutate({ jobType: worker.job_type, enabled: checked })
                        }
                        disabled={toggleMutation.isPending}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {worker.status.startsWith('paused') && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => resumeWorker(worker.job_type)}
                          >
                            <Play className="h-3 w-3 mr-1" />
                            Resume
                          </Button>
                        )}
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => openEditDialog(worker)}
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Governance Rules Info */}
      <Card className="glass-card border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-primary" />
            Governance-Regeln
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-start gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <strong>Budget-Stop:</strong> Worker pausiert automatisch bei Erreichen des Tageslimits
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <strong>Error-Rate-Stop:</strong> Worker pausiert bei Überschreiten der Fehlerrate (min. 5 Runs)
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Activity className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <strong>Parallel-Limit:</strong> Max. Anzahl gleichzeitiger Jobs pro Worker
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit Policy Dialog */}
      <Dialog open={!!editingPolicy} onOpenChange={(open) => !open && setEditingPolicy(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Policy bearbeiten: {editingPolicy?.job_type}</DialogTitle>
            <DialogDescription>
              Passe die Limits und Budgets für diesen Worker an
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="max_parallel">Max. Parallel</Label>
                <Input
                  id="max_parallel"
                  type="number"
                  min={1}
                  max={10}
                  value={formData.max_parallel || ''}
                  onChange={(e) => setFormData({ ...formData, max_parallel: parseInt(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max_attempts">Max. Versuche</Label>
                <Input
                  id="max_attempts"
                  type="number"
                  min={1}
                  max={10}
                  value={formData.max_attempts || ''}
                  onChange={(e) => setFormData({ ...formData, max_attempts: parseInt(e.target.value) })}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="timeout_seconds">Timeout (Sekunden)</Label>
                <Input
                  id="timeout_seconds"
                  type="number"
                  min={30}
                  max={3600}
                  value={formData.timeout_seconds || ''}
                  onChange={(e) => setFormData({ ...formData, timeout_seconds: parseInt(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max_tokens_per_run">Max. Tokens/Run</Label>
                <Input
                  id="max_tokens_per_run"
                  type="number"
                  min={1000}
                  step={1000}
                  value={formData.max_tokens_per_run || ''}
                  onChange={(e) => setFormData({ ...formData, max_tokens_per_run: parseInt(e.target.value) })}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="max_cost_eur_per_day">Tagesbudget (€)</Label>
                <Input
                  id="max_cost_eur_per_day"
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={formData.max_cost_eur_per_day || ''}
                  onChange={(e) => setFormData({ ...formData, max_cost_eur_per_day: parseFloat(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pause_on_error_rate">Fehlerrate-Limit (%)</Label>
                <Input
                  id="pause_on_error_rate"
                  type="number"
                  min={1}
                  max={100}
                  value={formData.pause_on_error_rate ? formData.pause_on_error_rate * 100 : ''}
                  onChange={(e) => setFormData({ ...formData, pause_on_error_rate: parseFloat(e.target.value) / 100 })}
                />
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPolicy(null)}>
              Abbrechen
            </Button>
            <Button onClick={handleSavePolicy} disabled={updatePolicyMutation.isPending}>
              {updatePolicyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
