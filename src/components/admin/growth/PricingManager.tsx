import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Pencil, DollarSign, TrendingUp, Package, BarChart3, Euro } from 'lucide-react';
import { toast } from 'sonner';

function useCostSnapshots() {
  return useQuery({
    queryKey: ['cost-snapshots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('certification_cost_snapshots')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });
}

function usePriceRecommendations() {
  return useQuery({
    queryKey: ['price-recommendations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_price_recommendation' as any)
        .select('*')
        .limit(100);
      if (error) return [];
      return data || [];
    },
  });
}

function useCoursesBundles() {
  return useQuery({
    queryKey: ['course-bundles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_bundles')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return [];
      return data || [];
    },
  });
}

export default function PricingManager() {
  const { data: snapshots, isLoading: loadingSnap } = useCostSnapshots();
  const { data: recommendations } = usePriceRecommendations();
  const { data: bundles } = useCoursesBundles();
  const qc = useQueryClient();

  const updateBundle = useMutation({
    mutationFn: async ({ id, bundle_price }: { id: string; bundle_price: number }) => {
      const { error } = await supabase.from('course_bundles').update({ bundle_price } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['course-bundles'] }); toast.success('Preis aktualisiert'); },
    onError: (e: any) => toast.error(e.message),
  });

  if (loadingSnap) return <Skeleton className="h-60" />;

  const totalRevPotential = (snapshots || []).reduce((sum, s) => sum + (s.selling_price_eur || 0), 0);
  const totalCost = (snapshots || []).reduce((sum, s) => sum + (s.total_cost_eur || 0), 0);
  const avgBreakEven = (snapshots || []).reduce((sum, s) => sum + (s.break_even_sales || 0), 0) / Math.max(1, (snapshots || []).length);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Kurse mit Preisen</p><p className="text-2xl font-bold">{(snapshots || []).length}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Umsatzpotential</p><p className="text-2xl font-bold text-emerald-600">{totalRevPotential.toFixed(0)}€</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Gesamtkosten</p><p className="text-2xl font-bold text-amber-600">{totalCost.toFixed(0)}€</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ø Break-Even</p><p className="text-2xl font-bold">{avgBreakEven.toFixed(0)} Sales</p></CardContent></Card>
      </div>

      {/* Bundles */}
      {(bundles || []).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Package className="h-4 w-4" /> Kurs-Bundles</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(bundles || []).map((b: any) => (
              <div key={b.id} className="flex items-center justify-between text-xs bg-muted/30 rounded px-3 py-2">
                <div>
                  <span className="font-semibold">{b.name || b.id.slice(0, 8)}</span>
                  {b.original_price && <span className="text-muted-foreground ml-2 line-through">{b.original_price}€</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-500/15 text-emerald-600 text-xs">{b.bundle_price}€</Badge>
                  <Dialog>
                    <DialogTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><Pencil className="h-3 w-3" /></Button></DialogTrigger>
                    <DialogContent className="max-w-sm">
                      <DialogHeader><DialogTitle>Bundle-Preis bearbeiten</DialogTitle></DialogHeader>
                      <BundlePriceForm current={b.bundle_price} onSave={price => updateBundle.mutate({ id: b.id, bundle_price: price })} />
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Cost Snapshots */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Euro className="h-4 w-4" /> Preis & Kosten pro Kurs</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {(snapshots || []).map(s => (
              <div key={s.id} className="flex items-center justify-between px-4 py-2 text-xs hover:bg-muted/20">
                <div className="min-w-0 flex-1">
                  <span className="font-medium truncate block">{s.certification_name || s.certification_id?.slice(0, 8)}</span>
                  <span className="text-[10px] text-muted-foreground">Kosten: {s.total_cost_eur?.toFixed(2)}€ · BE: {s.break_even_sales} Sales</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className="bg-emerald-500/15 text-emerald-600">{s.selling_price_eur || 0}€</Badge>
                  <Badge variant="outline" className="text-[9px]">Q: {s.total_questions || 0}</Badge>
                  <Badge variant="outline" className="text-[9px]">Cov: {s.coverage_pct || 0}%</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BundlePriceForm({ current, onSave }: { current: number; onSave: (price: number) => void }) {
  const [price, setPrice] = useState(current.toString());
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Preis (EUR)</Label>
        <Input type="number" value={price} onChange={e => setPrice(e.target.value)} className="h-8" />
      </div>
      <Button size="sm" onClick={() => onSave(parseFloat(price) || 0)}>Speichern</Button>
    </div>
  );
}
