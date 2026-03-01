import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';

const BerufsKICorporatePage = () => {
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [plan, setPlan] = useState('team_10');
  const [scope, setScope] = useState('product');
  const [scopeId, setScopeId] = useState('');
  const [loading, setLoading] = useState(false);

  const startCheckout = async () => {
    if (!email || !org || !scopeId) return toast.error('Alle Felder ausfüllen');
    
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('berufski-corporate-checkout', {
        body: { buyerEmail: email, orgName: org, plan, scope, scopeId },
      });

      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        toast.error(data?.error || 'Checkout fehlgeschlagen');
      }
    } catch (err: any) {
      toast.error(err.message || 'Fehler beim Checkout');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-xl p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Corporate Lizenz</CardTitle>
          <CardDescription>
            Für Teams, Unternehmen &amp; Behörden. Nach Zahlung erhältst du automatisch Lizenz-Key + Download (mit Wasserzeichen).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Organisation" value={org} onChange={(e) => setOrg(e.target.value)} />
          <Input placeholder="E-Mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          
          <Select value={plan} onValueChange={setPlan}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="team_10">Team Lizenz (bis 10) — 99 €</SelectItem>
              <SelectItem value="company_100">Unternehmenslizenz (bis 100) — 299 €</SelectItem>
              <SelectItem value="site">Standortlizenz — 799 €</SelectItem>
            </SelectContent>
          </Select>

          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="product">für Produkt</SelectItem>
              <SelectItem value="bundle">für Bundle</SelectItem>
            </SelectContent>
          </Select>

          <Input placeholder="Scope ID (Product oder Bundle ID)" value={scopeId} onChange={(e) => setScopeId(e.target.value)} />

          <Button className="w-full" onClick={startCheckout} disabled={loading}>
            {loading ? 'Wird geladen...' : 'Checkout starten'}
          </Button>

          <p className="text-xs text-muted-foreground">
            Soft-Watermark im Footer (lizenziert für Organisation + Key-Auszug). Kein hartes DRM.
          </p>
        </CardContent>
      </Card>
    </main>
  );
};

export default BerufsKICorporatePage;
