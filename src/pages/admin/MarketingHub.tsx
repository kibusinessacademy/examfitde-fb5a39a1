import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Plus, 
  Tag, 
  Package, 
  Mail, 
  Users,
  Percent,
  DollarSign,
  Calendar,
  Copy,
  Edit,
  Trash2,
  Send,
  Eye
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// Promo Codes Tab
function PromoCodesTab() {
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

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-muted-foreground">Verwalte Rabattcodes und Aktionen</p>
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
                  checked={code.is_active} 
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

// Course Bundles Tab
function BundlesTab() {
  const { data: bundles, isLoading } = useQuery({
    queryKey: ['course-bundles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_bundles')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-muted-foreground">Kurs-Bundles und Paketangebote</p>
        <Button><Plus className="h-4 w-4 mr-2" /> Neues Bundle</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {bundles?.map((bundle) => (
          <Card key={bundle.id} className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                {bundle.name}
              </CardTitle>
              <CardDescription>{bundle.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-2xl font-bold">{bundle.bundle_price}€</span>
                {bundle.original_price && (
                  <span className="text-muted-foreground line-through">{bundle.original_price}€</span>
                )}
              </div>
              <Badge variant={bundle.is_active ? 'default' : 'secondary'}>
                {bundle.is_active ? 'Aktiv' : 'Inaktiv'}
              </Badge>
            </CardContent>
          </Card>
        ))}
        {bundles?.length === 0 && (
          <Card className="glass-card col-span-full py-8">
            <CardContent className="text-center text-muted-foreground">
              Noch keine Bundles erstellt
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// Newsletter Tab
function NewsletterTab() {
  const { data: subscribers, isLoading: loadingSubs } = useQuery({
    queryKey: ['newsletter-subscribers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('newsletter_subscribers')
        .select('*')
        .order('subscribed_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    }
  });

  const { data: campaigns, isLoading: loadingCampaigns } = useQuery({
    queryKey: ['email-campaigns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    }
  });

  if (loadingSubs || loadingCampaigns) return <Skeleton className="h-64 w-full" />;

  const activeSubscribers = subscribers?.filter(s => s.is_subscribed).length || 0;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Aktive Abonnenten</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeSubscribers}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Kampagnen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaigns?.length || 0}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Geplant</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {campaigns?.filter(c => c.status === 'scheduled').length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Campaigns */}
      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>E-Mail Kampagnen</CardTitle>
            <CardDescription>Verwalte Newsletter und Kampagnen</CardDescription>
          </div>
          <Button><Plus className="h-4 w-4 mr-2" /> Neue Kampagne</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kampagne</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Gesendet</TableHead>
                <TableHead>Öffnungsrate</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns?.map((campaign) => {
                const stats = campaign.stats as { sent?: number; opened?: number } || {};
                const openRate = stats.sent ? Math.round((stats.opened || 0) / stats.sent * 100) : 0;
                
                return (
                  <TableRow key={campaign.id}>
                    <TableCell className="font-medium">{campaign.name}</TableCell>
                    <TableCell>
                      <Badge variant={
                        campaign.status === 'sent' ? 'default' :
                        campaign.status === 'scheduled' ? 'secondary' :
                        campaign.status === 'draft' ? 'outline' : 'destructive'
                      }>
                        {campaign.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {campaign.sent_at 
                        ? format(new Date(campaign.sent_at), 'dd.MM.yyyy HH:mm', { locale: de })
                        : '-'}
                    </TableCell>
                    <TableCell>{openRate}%</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon"><Eye className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon"><Edit className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {campaigns?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Noch keine Kampagnen erstellt
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// Affiliates Tab
function AffiliatesTab() {
  const { data: affiliates, isLoading } = useQuery({
    queryKey: ['affiliates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('affiliates')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const { data: pendingPayouts } = useQuery({
    queryKey: ['pending-payouts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('affiliates')
        .select('id, pending_payout')
        .gt('pending_payout', 0);
      if (error) throw error;
      return data?.reduce((sum, a) => sum + (a.pending_payout || 0), 0) || 0;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const activeAffiliates = affiliates?.filter(a => a.status === 'active').length || 0;
  const totalEarnings = affiliates?.reduce((sum, a) => sum + (a.total_earnings || 0), 0) || 0;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Aktive Partner</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeAffiliates}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Gesamt Auszahlungen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalEarnings.toFixed(2)}€</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Ausstehend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">{(pendingPayouts || 0).toFixed(2)}€</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Bewerbungen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {affiliates?.filter(a => a.status === 'pending').length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Affiliates Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Affiliate Partner</CardTitle>
          <CardDescription>Verwalte dein Partnerprogramm</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner-Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provision</TableHead>
                <TableHead>Verdient</TableHead>
                <TableHead>Ausstehend</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {affiliates?.map((affiliate) => (
                <TableRow key={affiliate.id}>
                  <TableCell className="font-mono">{affiliate.affiliate_code}</TableCell>
                  <TableCell>
                    <Badge variant={
                      affiliate.status === 'active' ? 'default' :
                      affiliate.status === 'pending' ? 'secondary' :
                      'destructive'
                    }>
                      {affiliate.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{affiliate.commission_rate}%</TableCell>
                  <TableCell>{(affiliate.total_earnings || 0).toFixed(2)}€</TableCell>
                  <TableCell className="text-orange-500">
                    {(affiliate.pending_payout || 0).toFixed(2)}€
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon"><Edit className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {affiliates?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Noch keine Affiliates registriert
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function MarketingHub() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Marketing & Vertrieb</h1>
        <p className="text-muted-foreground">Promo-Codes, Bundles, Newsletter und Affiliate-Management</p>
      </div>

      <Tabs defaultValue="promo-codes" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="promo-codes" className="gap-2">
            <Tag className="h-4 w-4" /> Promo-Codes
          </TabsTrigger>
          <TabsTrigger value="bundles" className="gap-2">
            <Package className="h-4 w-4" /> Bundles
          </TabsTrigger>
          <TabsTrigger value="newsletter" className="gap-2">
            <Mail className="h-4 w-4" /> Newsletter
          </TabsTrigger>
          <TabsTrigger value="affiliates" className="gap-2">
            <Users className="h-4 w-4" /> Affiliates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="promo-codes">
          <PromoCodesTab />
        </TabsContent>
        <TabsContent value="bundles">
          <BundlesTab />
        </TabsContent>
        <TabsContent value="newsletter">
          <NewsletterTab />
        </TabsContent>
        <TabsContent value="affiliates">
          <AffiliatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
