import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';

const BerufsKIBundleBuyPage = () => {
  const [email, setEmail] = useState('');
  const [coupon, setCoupon] = useState('');
  const [affiliate, setAffiliate] = useState('');
  const [loading, setLoading] = useState(false);

  // Get bundleId from URL
  const params = new URLSearchParams(window.location.search);
  const bundleId = window.location.pathname.split('/').pop() || params.get('bundleId') || '';

  const startCheckout = async () => {
    if (!email) return toast.error('E-Mail ist erforderlich');
    if (!bundleId) return toast.error('Bundle ID fehlt');
    
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('berufski-bundle-checkout', {
        body: {
          bundleId,
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
          <CardTitle className="text-2xl">Bundle kaufen</CardTitle>
          <CardDescription>
            Du erhältst den Bundle-Download per E-Mail (PDF / optional ZIP).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="E-Mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input placeholder="Coupon (optional)" value={coupon} onChange={(e) => setCoupon(e.target.value)} />
          <Input placeholder="Affiliate Code (optional)" value={affiliate} onChange={(e) => setAffiliate(e.target.value)} />
          <Button className="w-full" onClick={startCheckout} disabled={loading}>
            {loading ? 'Wird geladen...' : 'Checkout starten'}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
};

export default BerufsKIBundleBuyPage;
