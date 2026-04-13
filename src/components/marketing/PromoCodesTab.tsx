import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Copy, Percent, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function PromoCodesTab() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: promoCodes, isLoading } = useQuery({
    queryKey: ['promo-codes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('promo_codes')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const createPromoCode = useMutation({
    mutationFn: async (formData: FormData) => {
      const code = formData.get('code') as string;
      const discountType = formData.get('discountType') as string;
      const discountValue = parseFloat(formData.get('discountValue') as string);
      const maxUses = formData.get('maxUses') ? parseInt(formData.get('maxUses') as string) : null;
      const validUntil = formData.get('validUntil') as string || null;
      const description = formData.get('description') as string || null;

      const { error } = await supabase.from('promo_codes').insert({
        code: code.toUpperCase(),
        discount_type: discountType,
        discount_value: discountValue,
        max_uses: maxUses,
        valid_until: validUntil || null,
        description,
        is_active: true
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promo-codes'] });
      setIsCreateOpen(false);
      toast.success('Promo-Code erstellt');
    },
    onError: () => toast.error('Fehler beim Erstellen')
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase.from('promo_codes').update({ is_active: isActive }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promo-codes'] });
      toast.success('Status aktualisiert');
    }
  });

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success('Code kopiert');
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-muted-foreground">Rabattcodes und Aktionen</p>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Neuer Code</Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={(e) => { e.preventDefault(); createPromoCode.mutate(new FormData(e.target as HTMLFormElement)); }}>
              <DialogHeader>
                <DialogTitle>Neuen Promo-Code erstellen</DialogTitle>
                <DialogDescription>Erstelle einen neuen Rabattcode für deine Kunden.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="code">Code</Label>
                  <Input id="code" name="code" placeholder="SUMMER2024" required className="uppercase" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="discountType">Rabatttyp</Label>
                    <Select name="discountType" defaultValue="percentage">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Prozent</SelectItem>
                        <SelectItem value="fixed">Festbetrag</SelectItem>
                        <SelectItem value="free_trial">Gratis-Testphase</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="discountValue">Wert</Label>
                    <Input id="discountValue" name="discountValue" type="number" step="0.01" required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="maxUses">Max. Nutzungen</Label>
                    <Input id="maxUses" name="maxUses" type="number" placeholder="Unbegrenzt" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="validUntil">Gültig bis</Label>
                    <Input id="validUntil" name="validUntil" type="datetime-local" />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">Beschreibung</Label>
                  <Textarea id="description" name="description" placeholder="Interne Notizen..." />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createPromoCode.isPending}>
                  {createPromoCode.isPending ? 'Erstelle...' : 'Erstellen'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Rabatt</TableHead>
            <TableHead>Nutzungen</TableHead>
            <TableHead>Gültig bis</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Aktionen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {promoCodes?.map((code) => (
            <TableRow key={code.id}>
              <TableCell className="font-mono font-bold">{code.code}</TableCell>
              <TableCell>
                {code.discount_type === 'percentage' && <><Percent className="h-4 w-4 inline mr-1" />{code.discount_value}%</>}
                {code.discount_type === 'fixed' && <><DollarSign className="h-4 w-4 inline mr-1" />{code.discount_value}€</>}
                {code.discount_type === 'free_trial' && 'Gratis-Test'}
              </TableCell>
              <TableCell>{code.current_uses} / {code.max_uses || '∞'}</TableCell>
              <TableCell>
                {code.valid_until
                  ? format(new Date(code.valid_until), 'dd.MM.yyyy', { locale: de })
                  : 'Unbegrenzt'}
              </TableCell>
              <TableCell>
                <Switch
                  checked={code.is_active ?? false}
                  onCheckedChange={(checked) => toggleActive.mutate({ id: code.id, isActive: checked })}
                />
              </TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="icon" onClick={() => copyCode(code.code)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {promoCodes?.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                Noch keine Promo-Codes erstellt
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
