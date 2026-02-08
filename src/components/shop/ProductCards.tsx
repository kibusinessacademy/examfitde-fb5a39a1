import { useState } from 'react';
import { Check, BookOpen, GraduationCap, Brain, Mic, Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
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

const FEATURES = {
  learning_course: { icon: BookOpen, label: 'Lerninhaltekurs', description: '5-Schritte-Didaktik & MiniChecks' },
  exam_trainer: { icon: GraduationCap, label: 'Prüfungstrainer', description: 'Blueprint-basierte Prüfungssimulation' },
  ai_tutor: { icon: Brain, label: 'AI-Tutor', description: 'Intelligente Lernunterstützung' },
  oral_trainer: { icon: Mic, label: 'Mündliche Prüfung', description: 'Simulation mit KI-Feedback' },
};

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export function ProductCards({ curriculumId }: ProductCardProps) {
  const { data: products, isLoading } = useShopProducts();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});
  const { initiateCheckout, isLoading: checkoutLoading } = useCheckout();

  const handleQuantityChange = (productId: string, value: number[]) => {
    setSelectedQuantities(prev => ({ ...prev, [productId]: value[0] }));
  };

  const handleCheckout = async (productKey: string) => {
    if (!user) {
      toast.error('Bitte melden Sie sich an');
      navigate('/auth');
      return;
    }

    const product = products?.find(p => p.product_key === productKey);
    if (!product) return;

    const quantity = selectedQuantities[product.id] || 1;

    try {
      await initiateCheckout(productKey, curriculumId, quantity);
      toast.success('Checkout gestartet');
    } catch {
      toast.error('Checkout fehlgeschlagen');
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-6 md:grid-cols-3">
        {[1, 2, 3].map(i => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="h-32 bg-muted/50" />
            <CardContent className="h-48 bg-muted/30" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {products?.map(product => (
        <ProductCard
          key={product.id}
          product={product}
          quantity={selectedQuantities[product.id] || 1}
          onQuantityChange={(val) => handleQuantityChange(product.id, val)}
          onCheckout={() => handleCheckout(product.product_key)}
          isCheckoutLoading={checkoutLoading}
          isRecommended={product.product_key === 'bundle'}
        />
      ))}
    </div>
  );
}

interface SingleProductCardProps {
  product: {
    id: string;
    product_key: string;
    name: string;
    description: string | null;
    includes_learning_course: boolean;
    includes_exam_trainer: boolean;
    includes_ai_tutor: boolean;
    includes_oral_trainer: boolean;
  };
  quantity: number;
  onQuantityChange: (value: number[]) => void;
  onCheckout: () => void;
  isCheckoutLoading: boolean;
  isRecommended?: boolean;
}

function ProductCard({
  product,
  quantity,
  onQuantityChange,
  onCheckout,
  isCheckoutLoading,
  isRecommended,
}: SingleProductCardProps) {
  const { data: priceData } = useCalculatePrice(product.id, quantity);

  const includedFeatures = [
    product.includes_learning_course && 'learning_course',
    product.includes_exam_trainer && 'exam_trainer',
    product.includes_ai_tutor && 'ai_tutor',
    product.includes_oral_trainer && 'oral_trainer',
  ].filter(Boolean) as string[];

  return (
    <Card className={`relative flex flex-col ${isRecommended ? 'border-primary ring-2 ring-primary/20' : ''}`}>
      {isRecommended && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary">
          <Sparkles className="w-3 h-3 mr-1" />
          Empfohlen
        </Badge>
      )}
      
      <CardHeader>
        <CardTitle className="text-xl">{product.name}</CardTitle>
        <CardDescription>{product.description}</CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-6">
        {/* Features */}
        <div className="space-y-2">
          {includedFeatures.map(featureKey => {
            const feature = FEATURES[featureKey as keyof typeof FEATURES];
            return (
              <div key={featureKey} className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-primary" />
                <feature.icon className="w-4 h-4 text-muted-foreground" />
                <span>{feature.label}</span>
              </div>
            );
          })}
        </div>

        {/* Quantity Selector */}
        <div className="space-y-3 pt-4 border-t">
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
              {priceData.tier_name} – Sie sparen!
            </p>
          )}
        </div>

        {/* Price Display */}
        <div className="space-y-1 text-center pt-4 border-t">
          <div className="text-3xl font-bold text-primary">
            {priceData ? formatPrice(priceData.total_price_cents) : '...'}
          </div>
          {quantity > 1 && priceData && (
            <p className="text-sm text-muted-foreground">
              {formatPrice(priceData.unit_price_cents)} pro Lizenz
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            12 Monate Zugang
          </p>
        </div>
      </CardContent>

      <CardFooter>
        <Button
          className="w-full"
          size="lg"
          onClick={onCheckout}
          disabled={isCheckoutLoading}
        >
          {isCheckoutLoading ? 'Wird geladen...' : 'Jetzt kaufen'}
        </Button>
      </CardFooter>
    </Card>
  );
}
