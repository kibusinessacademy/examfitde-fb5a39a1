import { useState, useEffect, useRef } from 'react';
import { PRICING } from '@/config/pricing';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCheckout, useShopProducts, useCalculatePrice } from '@/hooks/useShop';
import { useCurriculumProductStats } from '@/hooks/useCurriculumProductStats';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL, seoTitle } from '@/lib/seo';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';

// Sections
import { ProductHero } from '@/components/shop/ProductHero';
import { ProductPainSection } from '@/components/shop/ProductPainSection';
import { ProductUSPBanner, ProductModulesSection } from '@/components/shop/ProductModulesSection';
import { ProductHowItWorks } from '@/components/shop/ProductHowItWorks';
import { ProductTrustSection } from '@/components/shop/ProductTrustSection';
import { ProductB2BSection } from '@/components/shop/ProductB2BSection';
import { StickyPurchaseBar } from '@/components/shop/StickyPurchaseBar';
import { formatEur } from '@/lib/timezone';

export default function ShopPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string | null>(
    searchParams.get('curriculum') || null
  );
  const [showSticky, setShowSticky] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  const { data: curricula, isLoading: curriculaLoading } = useQuery({
    queryKey: ['frozen-curricula'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curricula')
        .select('id, title')
        .eq('status', 'frozen')
        .order('title');
      if (error) throw error;
      return data;
    },
  });

  // Auto-select first curriculum
  useEffect(() => {
    if (curricula?.length && !selectedCurriculumId) {
      setSelectedCurriculumId(curricula[0].id);
    }
  }, [curricula, selectedCurriculumId]);

  const { data: stats } = useCurriculumProductStats(selectedCurriculumId);
  const { data: products } = useShopProducts();
  const mainProduct = products?.find(p => p.product_key === 'bundle') || products?.[0];
  const { data: priceData } = useCalculatePrice(mainProduct?.id, 1);
  const { initiateCheckout, isLoading: checkoutLoading } = useCheckout();

  // Show sticky bar after hero scrolls out
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setShowSticky(!entry.isIntersecting),
      { threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const priceDisplay = priceData ? formatEur(priceData.total_price_cents) : PRICING.defaultPrice;

  const cleanTitle = (stats?.title || '')
    .replace(/^Rahmenlehrplan\s+/i, '')
    .replace(/^Modulhandbuch\s+/i, '');

  const handleBuy = async () => {
    if (!user) {
      toast.error('Bitte melde dich an');
      navigate('/auth');
      return;
    }
    if (!mainProduct) return;
    try {
      await initiateCheckout(mainProduct.product_key, selectedCurriculumId!, 1);
    } catch {
      toast.error('Checkout fehlgeschlagen');
    }
  };

  return (
    <>
      <SEOHead
        title={seoTitle(
          stats
            ? `${cleanTitle} Prüfung bestehen – Prüfungstraining`
            : 'IHK Prüfungstraining kaufen: Prüfungsfragen üben & bestehen'
        )}
        description={`${cleanTitle || 'IHK'} Prüfungstraining: Prüfungssimulation, echte Prüfungsfragen, KI-Coach & mündliche Prüfung. ${priceDisplay} einmalig, ${PRICING.defaultAccess} Zugang.`}
        canonical={`${SITE_URL}/shop`}
      />

      <div className="min-h-screen pb-24">
        {/* Curriculum Selector (if multiple) */}
        {curricula && curricula.length > 1 && (
          <div className="max-w-md mx-auto px-4 pt-6">
            <Select
              value={selectedCurriculumId || ''}
              onValueChange={setSelectedCurriculumId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Beruf auswählen..." />
              </SelectTrigger>
              <SelectContent>
                {curricula.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title.replace(/^Rahmenlehrplan\s+/i, '').replace(/^Modulhandbuch\s+/i, '')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* HERO */}
        <div ref={heroRef}>
          <ProductHero
            title={stats?.title || 'Deine Prüfung'}
            chamberType={stats?.chamber_type || 'IHK'}
            catalogType={stats?.catalog_type || 'Ausbildung'}
            onBuyClick={handleBuy}
            isCheckoutLoading={checkoutLoading}
            priceDisplay={priceDisplay}
          />
        </div>

        {/* PAIN */}
        <ProductPainSection cleanTitle={cleanTitle || 'Azubis'} />

        {/* USP */}
        <ProductUSPBanner />

        {/* MODULES */}
        {stats && <ProductModulesSection stats={stats} />}

        {/* HOW IT WORKS */}
        <ProductHowItWorks />

        {/* TRUST */}
        <ProductTrustSection
          chamberType={stats?.chamber_type || 'IHK'}
          cleanTitle={cleanTitle || 'deinen Beruf'}
        />

        {/* B2B */}
        <ProductB2BSection />

        {/* Final CTA */}
        <section className="py-12 md:py-16 text-center px-4">
          <h2 className="text-2xl md:text-3xl font-display font-bold mb-4">
            Bereit für die Prüfung?
          </h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Starte jetzt mit deinem persönlichen Prüfungstraining.
            Du weißt sofort, ob du bestehst – oder wo du noch üben musst.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={handleBuy}
              disabled={checkoutLoading}
              className="inline-flex items-center justify-center gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 px-8 text-lg font-semibold"
            >
              {checkoutLoading ? 'Wird geladen...' : `Jetzt starten – ${priceDisplay}`}
            </button>
          </div>
        </section>

        {/* Sticky Bar */}
        <StickyPurchaseBar
          priceDisplay={priceDisplay}
          onBuyClick={handleBuy}
          isLoading={checkoutLoading}
          visible={showSticky}
        />
      </div>
    </>
  );
}
