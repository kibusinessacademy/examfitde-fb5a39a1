import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import { BRAND } from '@/lib/brand/ssot';

export default function WorkCorporatePage() {
  // self-service checkout state
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [plan, setPlan] = useState('team_10');
  const [scope, setScope] = useState('product');
  const [scopeId, setScopeId] = useState('');
  const [loading, setLoading] = useState(false);

  // demo request state
  const [demoCompany, setDemoCompany] = useState('');
  const [demoName, setDemoName] = useState('');
  const [demoEmail, setDemoEmail] = useState('');
  const [demoPhone, setDemoPhone] = useState('');
  const [demoSeats, setDemoSeats] = useState<string>('');
  const [demoIndustry, setDemoIndustry] = useState('');
  const [demoMessage, setDemoMessage] = useState('');
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoSent, setDemoSent] = useState(false);

  const startCheckout = async () => {
    if (!email || !org || !scopeId) return toast.error('Alle Felder ausfüllen');
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('berufski-corporate-checkout', {
        body: { buyerEmail: email, orgName: org, plan, scope, scopeId },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
      else toast.error(data?.error || 'Checkout fehlgeschlagen');
    } catch (err: any) {
      toast.error(err.message || 'Fehler beim Checkout');
    } finally {
      setLoading(false);
    }
  };

  const submitDemoRequest = async () => {
    if (!demoCompany || !demoEmail) {
      return toast.error('Firma und E-Mail sind Pflicht.');
    }
    setDemoLoading(true);
    try {
      const seatsNum = demoSeats ? parseInt(demoSeats, 10) : null;
      const { error } = await supabase.rpc('submit_b2b_demo_request' as any, {
        p_company_name: demoCompany,
        p_contact_name: demoName || null,
        p_contact_email: demoEmail,
        p_contact_phone: demoPhone || null,
        p_industry: demoIndustry || null,
        p_azubi_count: seatsNum,
        p_seats: seatsNum,
        p_message: demoMessage || null,
        p_source: 'website',
      });
      if (error) throw error;
      setDemoSent(true);
      toast.success('Anfrage gesendet — wir melden uns innerhalb 1 Werktag.');
    } catch (err: any) {
      toast.error(err.message || 'Anfrage konnte nicht gesendet werden.');
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="text-center mb-6">
        <h1 className="text-3xl font-display font-bold">{BRAND.name} für Teams &amp; Unternehmen</h1>
        <p className="text-muted-foreground mt-2">
          Self-Service-Lizenz oder persönliches Angebot — du entscheidest.
        </p>
      </header>

      <Tabs defaultValue="demo" className="w-full">
        <TabsList className="grid grid-cols-2 w-full mb-4">
          <TabsTrigger value="demo">Demo / Angebot anfragen</TabsTrigger>
          <TabsTrigger value="self">Selbst kaufen</TabsTrigger>
        </TabsList>

        <TabsContent value="demo">
          <Card>
            <CardHeader>
              <CardTitle>Persönliches Angebot</CardTitle>
              <CardDescription>
                Für Ausbildungsbetriebe, Berufsschulen &amp; Behörden. Wir melden uns innerhalb 1 Werktag mit Mengenrabatt &amp; Onboarding-Plan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {demoSent ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <CheckCircle2 className="h-12 w-12 text-primary" />
                  <p className="font-semibold">Danke! Anfrage eingegangen.</p>
                  <p className="text-sm text-muted-foreground">
                    Du hörst innerhalb 1 Werktag von uns — meist sofort.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="demo-company">Organisation*</Label>
                      <Input id="demo-company" value={demoCompany} onChange={(e) => setDemoCompany(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="demo-name">Ansprechpartner</Label>
                      <Input id="demo-name" value={demoName} onChange={(e) => setDemoName(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="demo-email">E-Mail*</Label>
                      <Input id="demo-email" type="email" value={demoEmail} onChange={(e) => setDemoEmail(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="demo-phone">Telefon</Label>
                      <Input id="demo-phone" value={demoPhone} onChange={(e) => setDemoPhone(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="demo-seats">Seats / Azubis</Label>
                      <Input id="demo-seats" type="number" min={1} value={demoSeats} onChange={(e) => setDemoSeats(e.target.value)} placeholder="z. B. 25" />
                    </div>
                    <div>
                      <Label htmlFor="demo-industry">Branche / Beruf</Label>
                      <Input id="demo-industry" value={demoIndustry} onChange={(e) => setDemoIndustry(e.target.value)} placeholder="z. B. Industrie, IT" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="demo-message">Nachricht</Label>
                    <Textarea id="demo-message" rows={3} value={demoMessage} onChange={(e) => setDemoMessage(e.target.value)} placeholder="Welche Prüfungen? Wann Start?" />
                  </div>
                  <Button className="w-full" onClick={submitDemoRequest} disabled={demoLoading}>
                    {demoLoading ? 'Wird gesendet...' : 'Angebot anfordern'}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Mit dem Absenden stimmst du zu, dass wir dich kontaktieren dürfen.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="self">
          <Card>
            <CardHeader>
              <CardTitle>Self-Service Lizenz</CardTitle>
              <CardDescription>
                Nach Zahlung erhältst du automatisch Lizenz-Key + Download.
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
        </TabsContent>
      </Tabs>
    </main>
  );
}
