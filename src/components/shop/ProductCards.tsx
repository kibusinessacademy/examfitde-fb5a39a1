import { useState } from 'react';
import { Check, Target, Brain, Mic, Sparkles, GraduationCap, BookOpen, Shield, Clock } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { useShopProducts, useCalculatePrice, useCheckout } from '@/hooks/useShop';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface ProductCardProps {
  curriculumId: string;
}

const ALL_FEATURES = [
  { icon: Target, label: 'Prüfungssimulation (schriftlich & mündlich)' },
  { icon: Brain, label: 'KI-Prüfungscoach mit Feedback' },
  { icon: GraduationCap, label: 'Adaptive Schwächenanalyse' },
  { icon: BookOpen, label: 'Prüfungswissen kompakt' },
  { icon: Shield, label: 'Prüfungsreife-Indikator' },
  { icon: Mic, label: 'Mündliche Prüfung üben' },
];

import { formatEur } from '@/lib/timezone';
const formatPrice = formatEur;

export function ProductCards({ curriculumId }: ProductCardProps) {
  const { data: products, isLoading } = useShopProducts();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [quantity, setQuantity] = useState(1);
  const { initiateCheckout, isLoading: checkoutLoading } = useCheckout();

  // Single-product strategy: use bundle or first available product
  const mainProduct = products?.find(p => p.product_key === 'bundle') || products?.[0];

  const handleCheckout = async () => {
    if (!user) {
      toast.error('Bitte melde dich an');
      navigate('/auth');
      return;
    }

    if (!mainProduct) return;

    try {
      await initiateCheckout(mainProduct.product_key, curriculumId, quantity);
      toast.success('Checkout gestartet');
    } catch {
      toast.error('Checkout fehlgeschlagen');
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto">
        <Card className="animate-pulse">
          <CardHeader className="h-32 bg-muted/50" />
          <CardContent className="h-48 bg-muted/30" />
        </Card>
      </div>
    );
  }

  if (!mainProduct) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Keine Produkte verfügbar.
      </div>
    );
  }

  return <SingleProductCard
    product={mainProduct}
    quantity={quantity}
    onQuantityChange={(val) => setQuantity(val[0])}
    onCheckout={handleCheckout}
    isCheckoutLoading={checkoutLoading}
  />;
}

interface SingleProductCardProps {
  product: {
    id: string;
    product_key: string;
    name: string;
    description: string | null;
  };
  quantity: number;
  onQuantityChange: (value: number[]) => void;
  onCheckout: () => void;
  isCheckoutLoading: boolean;
}

function SingleProductCard({
  product,
  quantity,
  onQuantityChange,
  onCheckout,
  isCheckoutLoading,
}: SingleProductCardProps) {
  const { data: priceData } = useCalculatePrice(product.id, quantity);

  return (
    <div className="max-w-lg mx-auto">
      <Card className="glass-card ring-2 ring-primary relative">
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary">
          <Sparkles className="w-3 h-3 mr-1" />
          Alles inklusive
        </Badge>

        <CardHeader className="text-center pt-8">
          <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-4 shadow-glow">
            <Target className="h-8 w-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-display">Intelligentes Prüfungstraining</CardTitle>
          <p className="text-muted-foreground mt-2">
            Alles, was du für die Abschlussprüfung brauchst – Prüfungsfragen, Simulation & KI-Coach in einem System.
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Features */}
          <ul className="grid sm:grid-cols-2 gap-3">
            {ALL_FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-primary flex-shrink-0" />
                <span>{label}</span>
              </li>
            ))}
          </ul>

          {/* Quantity Selector */}
          <div className="space-y-3 pt-4 border-t border-border">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Anzahl Lizenzen</span>
              <Badge variant="secondary" className="text-lg font-bold">
                {quantity}
              </Badge>
            </div>
            <Slider
              value={[quantity]}
              onValueChange={onQuantityChange}
              min={1}
              max={100}
              step={1}
              className="py-2"
            />
            {priceData?.tier_name && quantity > 1 && (
              <p className="text-xs text-primary text-center">
                {priceData.tier_name} – Du sparst!
              </p>
            )}
            {quantity >= 5 && (
              <p className="text-xs text-muted-foreground text-center">
                Ab 5 Lizenzen automatischer Mengenrabatt
              </p>
            )}
          </div>

          {/* Price Display */}
          <div className="space-y-1 text-center pt-4 border-t border-border">
            <div className="text-4xl font-display font-bold text-gradient">
              {priceData ? formatPrice(priceData.total_price_cents) : '24,90 €'}
            </div>
            {quantity > 1 && priceData && (
              <p className="text-sm text-muted-foreground">
                {formatPrice(priceData.unit_price_cents)} pro Lizenz
              </p>
            )}
            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground mt-2">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> 12 Monate</span>
              <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> Kein Abo</span>
            </div>
          </div>
        </CardContent>

        <CardFooter>
          <Button
            className="w-full gradient-primary text-primary-foreground shadow-glow rounded-xl h-14 text-lg"
            size="lg"
            onClick={onCheckout}
            disabled={isCheckoutLoading}
          >
            {isCheckoutLoading ? 'Wird geladen...' : 'Jetzt Prüfungstraining starten'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
