import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Copy, Percent, DollarSign, Trash2, Pencil, Search, Tag, Gift, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface PromoCode {
  id: string;
  code: string;
  discount_type: string;
  discount_value: number;
  max_uses: number | null;
  current_uses: number | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean | null;
  description: string | null;
  applicable_courses: string[] | null;
  min_purchase_amount: number | null;
  created_at: string | null;
  created_by: string | null;
}

function usePromoCodes() {
  return useQuery({
    queryKey: ['admin-promo-codes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('promo_codes')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PromoCode[];
    },
  });
}

function usePromoRedemptions() {
  return useQuery({
    queryKey: ['admin-promo-redemptions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('promo_code_redemptions')
        .select('id, promo_code_id, discount_applied, redeemed_at')
        .order('redeemed_at', { ascending: false })
        .limit(200);
      if (error) return [];
      return data ?? [];
    },
  });
}

function PromoCodeForm({
  initial,
  onSubmit,
  isPending,
  submitLabel,
}: {
  initial?: Partial<PromoCode>;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
  submitLabel: string;
}) {
  const [discountType, setDiscountType] = useState(initial?.discount_type ?? 'percentage');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.target as HTMLFormElement);
        onSubmit({
          code: (fd.get('code') as string).toUpperCase(),
          discount_type: discountType,
          discount_value: parseFloat(fd.get('discountValue') as string),
          max_uses: fd.get('maxUses') ? parseInt(fd.get('maxUses') as string) : null,
          valid_from: (fd.get('validFrom') as string) || null,
          valid_until: (fd.get('validUntil') as string) || null,
          description: (fd.get('description') as string) || null,
          min_purchase_amount: fd.get('minPurchase') ? parseFloat(fd.get('minPurchase') as string) : null,
          is_active: true,
        });
      }}
      className="space-y-4"
    >
      <div className="grid gap-2">
        <Label htmlFor="code">Code</Label>
        <Input id="code" name="code" placeholder="SUMMER2025" required className="uppercase font-mono" defaultValue={initial?.code ?? ''} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label>Rabatttyp</Label>
          <Select value={discountType} onValueChange={setDiscountType} name="discountType">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">Prozent (%)</SelectItem>
              <SelectItem value="fixed">Festbetrag (€)</SelectItem>
              <SelectItem value="free_trial">Gratis-Testphase</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="discountValue">Wert</Label>
          <Input id="discountValue" name="discountValue" type="number" step="0.01" required defaultValue={initial?.discount_value ?? ''} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="maxUses">Max. Nutzungen</Label>
          <Input id="maxUses" name="maxUses" type="number" placeholder="Unbegrenzt" defaultValue={initial?.max_uses ?? ''} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="minPurchase">Mindestbestellwert (€)</Label>
          <Input id="minPurchase" name="minPurchase" type="number" step="0.01" placeholder="Keiner" defaultValue={initial?.min_purchase_amount ?? ''} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="validFrom">Gültig ab</Label>
          <Input id="validFrom" name="validFrom" type="datetime-local" defaultValue={initial?.valid_from?.slice(0, 16) ?? ''} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="validUntil">Gültig bis</Label>
          <Input id="validUntil" name="validUntil" type="datetime-local" defaultValue={initial?.valid_until?.slice(0, 16) ?? ''} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="description">Beschreibung (intern)</Label>
        <Textarea id="description" name="description" placeholder="Interne Notizen..." defaultValue={initial?.description ?? ''} />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Speichere...' : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

export default function AdminPromoCodesPanel() {
  const queryClient = useQueryClient();
  const { data: promoCodes, isLoading } = usePromoCodes();
  const { data: redemptions } = usePromoRedemptions();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editCode, setEditCode] = useState<PromoCode | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-promo-codes'] });
    queryClient.invalidateQueries({ queryKey: ['admin-promo-redemptions'] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const { error } = await supabase.from('promo_codes').insert(data as never);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setCreateOpen(false); toast.success('Promo-Code erstellt'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: Record<string, unknown> & { id: string }) => {
      const { error } = await supabase.from('promo_codes').update(data as never).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setEditCode(null); toast.success('Promo-Code aktualisiert'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('promo_codes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setDeleteId(null); toast.success('Promo-Code gelöscht'); },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase.from('promo_codes').update({ is_active: isActive } as never).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Status aktualisiert'); },
  });

  // KPIs
  const totalCodes = promoCodes?.length ?? 0;
  const activeCodes = promoCodes?.filter(c => c.is_active).length ?? 0;
  const totalRedemptions = redemptions?.length ?? 0;
  const totalRevenueSaved = redemptions?.reduce((s, r) => s + (r.discount_applied ?? 0), 0) ?? 0;

  const filtered = promoCodes?.filter(c =>
    !search || c.code.toLowerCase().includes(search.toLowerCase()) ||
    c.description?.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  // Redemption count per code
  const redemptionsByCode = new Map<string, number>();
  redemptions?.forEach(r => {
    redemptionsByCode.set(r.promo_code_id, (redemptionsByCode.get(r.promo_code_id) ?? 0) + 1);
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <Tag className="h-5 w-5 text-primary shrink-0" />
            <div>
              <div className="text-lg font-bold text-foreground">{totalCodes}</div>
              <div className="text-[11px] text-muted-foreground">Codes gesamt</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Gift className="h-5 w-5 text-success shrink-0" />
            <div>
              <div className="text-lg font-bold text-foreground">{activeCodes}</div>
              <div className="text-[11px] text-muted-foreground">Aktiv</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-primary shrink-0" />
            <div>
              <div className="text-lg font-bold text-foreground">{totalRedemptions}</div>
              <div className="text-[11px] text-muted-foreground">Einlösungen</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-4 flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-warning shrink-0" />
            <div>
              <div className="text-lg font-bold text-foreground">{totalRevenueSaved.toFixed(0)}€</div>
              <div className="text-[11px] text-muted-foreground">Rabatt vergeben</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Code suchen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5"><Plus className="h-4 w-4" /> Neuer Code</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Neuen Promo-Code erstellen</DialogTitle>
              <DialogDescription>Erstelle einen neuen Rabattcode für deine Kunden.</DialogDescription>
            </DialogHeader>
            <PromoCodeForm
              onSubmit={(data) => createMutation.mutate(data)}
              isPending={createMutation.isPending}
              submitLabel="Erstellen"
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Promo-Codes</CardTitle>
          <CardDescription className="text-xs">{filtered.length} Codes</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Rabatt</TableHead>
                <TableHead>Nutzungen</TableHead>
                <TableHead className="hidden sm:table-cell">Gültig bis</TableHead>
                <TableHead className="hidden sm:table-cell">Min. Betrag</TableHead>
                <TableHead>Aktiv</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((code) => {
                const isExpired = code.valid_until ? new Date(code.valid_until) < new Date() : false;
                const usageRatio = code.max_uses ? (code.current_uses ?? 0) / code.max_uses : null;
                const isExhausted = usageRatio !== null && usageRatio >= 1;
                const actualRedemptions = redemptionsByCode.get(code.id) ?? 0;

                return (
                  <TableRow key={code.id} className={cn((!code.is_active || isExpired || isExhausted) && 'opacity-60')}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sm">{code.code}</span>
                        {isExpired && <Badge variant="outline" className="text-[9px] px-1 py-0 border-destructive/40 text-destructive">Abgelaufen</Badge>}
                        {isExhausted && <Badge variant="outline" className="text-[9px] px-1 py-0 border-warning/40 text-warning">Ausgeschöpft</Badge>}
                      </div>
                      {code.description && <div className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[200px]">{code.description}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        {code.discount_type === 'percentage' && <><Percent className="h-3.5 w-3.5" />{code.discount_value}%</>}
                        {code.discount_type === 'fixed' && <><DollarSign className="h-3.5 w-3.5" />{code.discount_value}€</>}
                        {code.discount_type === 'free_trial' && <Gift className="h-3.5 w-3.5 mr-1" />}
                        {code.discount_type === 'free_trial' && 'Gratis-Test'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{code.current_uses ?? 0} / {code.max_uses ?? '∞'}</span>
                      {actualRedemptions > 0 && (
                        <div className="text-[10px] text-muted-foreground">{actualRedemptions} bestätigt</div>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {code.valid_until
                        ? format(new Date(code.valid_until), 'dd.MM.yy HH:mm', { locale: de })
                        : '∞'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm">
                      {code.min_purchase_amount ? `${code.min_purchase_amount}€` : '—'}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={code.is_active ?? false}
                        onCheckedChange={(checked) => toggleActive.mutate({ id: code.id, isActive: checked })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { navigator.clipboard.writeText(code.code); toast.success('Kopiert'); }}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditCode(code)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(code.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {search ? 'Keine Codes gefunden' : 'Noch keine Promo-Codes erstellt'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editCode} onOpenChange={(v) => { if (!v) setEditCode(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promo-Code bearbeiten</DialogTitle>
            <DialogDescription>Code: {editCode?.code}</DialogDescription>
          </DialogHeader>
          {editCode && (
            <PromoCodeForm
              initial={editCode}
              onSubmit={(data) => updateMutation.mutate({ id: editCode.id, ...data })}
              isPending={updateMutation.isPending}
              submitLabel="Speichern"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Promo-Code löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dieser Vorgang kann nicht rückgängig gemacht werden. Bestehende Einlösungen bleiben erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
