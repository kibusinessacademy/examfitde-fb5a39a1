import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Sparkles, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const statusColors: Record<string, string> = {
  draft: 'outline',
  generated: 'secondary',
  validated: 'default',
  approved: 'default',
  active: 'default',
  completed: 'secondary',
};

export default function StrategyTab() {
  const queryClient = useQueryClient();

  const { data: plans, isLoading } = useQuery({
    queryKey: ['marketing-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_plans')
        .select('*')
        .order('month', { ascending: false })
        .limit(12);
      if (error) throw error;
      return data;
    }
  });

  const generatePlan = useMutation({
    mutationFn: async () => {
      const month = format(new Date(), 'yyyy-MM');
      const { error } = await supabase.from('marketing_plans').insert({
        month,
        strategy_json: {},
        budget_total: 100,
        budget_split: { seo: 40, paid: 40, email: 20, content: 0, reserve: 0 },
        hypotheses: [],
        priorities: ['Azubi Bundle', 'SEO Organic Growth'],
        status: 'draft',
        llm_used: 'openai/gpt-5.2'
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-plans'] });
      toast.success('Monatsplan erstellt');
    },
    onError: () => toast.error('Fehler beim Erstellen')
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: TablesUpdate<'marketing_plans'> = { status };
      if (status === 'approved') {
        updates.approved_at = new Date().toISOString();
        updates.approved_by = 'admin';
      }
      const { error } = await supabase.from('marketing_plans').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-plans'] });
      toast.success('Status aktualisiert');
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const activePlan = plans?.find(p => p.status === 'active' || p.status === 'approved');

  return (
    <div className="space-y-6">
      {/* Active Plan Summary */}
      {activePlan && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Aktiver Plan: {activePlan.month}
            </CardTitle>
            <CardDescription>Budget: {activePlan.budget_total}€</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {Object.entries(activePlan.budget_split as Record<string, number>).map(([k, v]) => (
                <div key={k} className="text-center p-2 rounded bg-background border">
                  <div className="text-xs text-muted-foreground capitalize">{k}</div>
                  <div className="text-lg font-bold">{v}€</div>
                </div>
              ))}
            </div>
            {(activePlan.priorities as string[])?.length > 0 && (
              <div className="flex gap-2 mt-3 flex-wrap">
                {(activePlan.priorities as string[]).map((p, i) => (
                  <Badge key={i} variant="secondary">{p}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Plans Table */}
      <div className="flex justify-between items-center">
        <p className="text-muted-foreground">Monatliche Strategiepläne (GPT-5.2 Deep Thinking)</p>
        <Button onClick={() => generatePlan.mutate()} disabled={generatePlan.isPending}>
          <Plus className="h-4 w-4 mr-2" /> Neuen Plan erstellen
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Monat</TableHead>
            <TableHead>Budget</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Validierung</TableHead>
            <TableHead>Genehmigt</TableHead>
            <TableHead className="text-right">Aktionen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plans?.map((plan) => (
            <TableRow key={plan.id}>
              <TableCell className="font-mono font-bold">{plan.month}</TableCell>
              <TableCell>{plan.budget_total}€</TableCell>
              <TableCell>
                <Badge variant={(statusColors[plan.status] || 'outline') as 'default' | 'secondary' | 'outline' | 'destructive'}>
                  {plan.status}
                </Badge>
              </TableCell>
              <TableCell>
                {plan.validation_score != null 
                  ? <span className={plan.validation_score >= 70 ? 'text-green-600' : 'text-orange-500'}>{plan.validation_score}%</span>
                  : <span className="text-muted-foreground">–</span>}
              </TableCell>
              <TableCell>
                {plan.approved_at
                  ? format(new Date(plan.approved_at), 'dd.MM.yy', { locale: de })
                  : '–'}
              </TableCell>
              <TableCell className="text-right space-x-1">
                {plan.status === 'draft' && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: plan.id, status: 'generated' })}>
                    Generieren
                  </Button>
                )}
                {plan.status === 'validated' && (
                  <>
                    <Button size="sm" onClick={() => updateStatus.mutate({ id: plan.id, status: 'approved' })}>
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Genehmigen
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => updateStatus.mutate({ id: plan.id, status: 'draft' })}>
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Ablehnen
                    </Button>
                  </>
                )}
                {plan.status === 'approved' && (
                  <Button size="sm" onClick={() => updateStatus.mutate({ id: plan.id, status: 'active' })}>
                    Aktivieren
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {plans?.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                Noch keine Pläne erstellt
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
