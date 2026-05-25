import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, ShoppingCart } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function BerufsKIBuyPage() {
  const { productId } = useParams<{ productId: string }>();
  const [searchParams] = useSearchParams();
  const affiliateFromUrl = searchParams.get('ref') || '';

  const [email, setEmail] = useState('');
  const [coupon, setCoupon] = useState('');
  const [affiliate, setAffiliate] = useState(affiliateFromUrl);
  const [loading, setLoading] = useState(false);

  async function startCheckout() {
    if (!email || !email.includes('@')) {
      toast.error('Bitte gib eine gültige E-Mail-Adresse ein.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('berufski-checkout', {
        body: {
          productId,
          buyerEmail: email,
          couponCode: coupon || null,
          affiliateCode: affiliate || null,
          landingPath: window.location.pathname,
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        toast.error(data?.error || 'Checkout konnte nicht gestartet werden.');
      }
    } catch (e) {
      toast.error(`Fehler: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Berufs-KI kaufen
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Gib deine E-Mail ein – du bekommst den Download-Link per Mail.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-Mail *</Label>
            <Input
              id="email"
              type="email"
              placeholder="deine@email.de"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coupon">Coupon (optional)</Label>
            <Input
              id="coupon"
              placeholder="z.B. START10"
              value={coupon}
              onChange={(e) => setCoupon(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="affiliate">Affiliate Code (optional)</Label>
            <Input
              id="affiliate"
              placeholder="z.B. EXAMFIT"
              value={affiliate}
              onChange={(e) => setAffiliate(e.target.value)}
            />
          </div>
          <Button className="w-full" onClick={startCheckout} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Checkout starten
          </Button>
          <p className="text-xs text-muted-foreground">
            DSGVO-sichere Nutzungsempfehlungen enthalten. Keine Rechtsberatung.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
