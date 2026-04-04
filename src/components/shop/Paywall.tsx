import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Lock, ShoppingCart, CheckCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface PaywallProps {
  feature: 'learning_course' | 'exam_trainer' | 'ai_tutor' | 'oral_trainer';
  curriculumId?: string;
  curriculumTitle?: string;
  isLoading?: boolean;
}

const FEATURE_NAMES: Record<PaywallProps['feature'], string> = {
  learning_course: 'Lerninhaltekurs',
  exam_trainer: 'Prüfungstrainer',
  ai_tutor: 'KI-Tutor',
  oral_trainer: 'Mündlicher Prüfungstrainer',
};

const FEATURE_PRODUCTS: Record<PaywallProps['feature'], { key: string; price: string }[]> = {
  learning_course: [
    { key: 'learning_course', price: '19 €' },
    { key: 'bundle', price: '24,90 €' },
  ],
  exam_trainer: [
    { key: 'exam_trainer', price: '24,90 €' },
    { key: 'bundle', price: '24,90 €' },
  ],
  ai_tutor: [
    { key: 'exam_trainer', price: '24,90 €' },
    { key: 'bundle', price: '24,90 €' },
  ],
  oral_trainer: [
    { key: 'exam_trainer', price: '24,90 €' },
    { key: 'bundle', price: '24,90 €' },
  ],
};

export function Paywall({ feature, curriculumId, curriculumTitle, isLoading }: PaywallProps) {
  const { user } = useAuth();
  const featureName = FEATURE_NAMES[feature];
  const products = FEATURE_PRODUCTS[feature];

  if (isLoading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <Card className="glass-card border-border/50 overflow-hidden">
        <div className="h-2 gradient-primary" />
        <CardHeader className="text-center pb-4">
          <div className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full glass-subtle mb-4 mx-auto">
            <Lock className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">Premium-Feature</span>
          </div>
          <CardTitle className="text-2xl font-display">
            {featureName} freischalten
          </CardTitle>
          <CardDescription className="text-base">
            {curriculumTitle && (
              <Badge variant="outline" className="mb-2">{curriculumTitle}</Badge>
            )}
            <br />
            Erhalte Zugang zu diesem Feature mit einer Lizenz.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Benefits */}
          <div className="space-y-3">
            {feature === 'learning_course' && (
              <>
                <BenefitItem>Modulare Lerninhalte nach Rahmenplan</BenefitItem>
                <BenefitItem>5-Schritte-Didaktik pro Lektion</BenefitItem>
                <BenefitItem>MiniChecks zur Selbstkontrolle</BenefitItem>
                <BenefitItem>Fortschritts- & Mastery-Tracking</BenefitItem>
              </>
            )}
            {(feature === 'exam_trainer' || feature === 'ai_tutor' || feature === 'oral_trainer') && (
              <>
                <BenefitItem>Unbegrenzte Prüfungssimulationen</BenefitItem>
                <BenefitItem>KI-Tutor für sofortige Hilfe</BenefitItem>
                <BenefitItem>Mündlicher Prüfungstrainer</BenefitItem>
                <BenefitItem>Detaillierte Auswertungen</BenefitItem>
              </>
            )}
            <BenefitItem>12 Monate Zugang ab Kaufdatum</BenefitItem>
          </div>

          {/* Product Options */}
          <div className="border-t border-border pt-6 space-y-3">
            <p className="text-sm text-muted-foreground text-center mb-4">
              Verfügbar in folgenden Paketen:
            </p>
            <div className="grid gap-3">
              {products.map(p => (
                <div 
                  key={p.key}
                  className="flex items-center justify-between p-4 rounded-xl border border-border bg-muted/30"
                >
                  <span className="font-medium">
                    {p.key === 'bundle' ? '🎁 Komplett-Bundle' : 
                     p.key === 'exam_trainer' ? '🎯 Prüfungstrainer' : 
                     '📚 Lerninhaltekurs'}
                  </span>
                  <span className="font-bold text-primary">ab {p.price}</span>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="pt-4 space-y-3">
            {user ? (
              <Link to="/shop" className="block">
                <Button className="w-full gradient-primary text-primary-foreground shadow-glow">
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Jetzt Lizenz kaufen
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/auth" className="block">
                  <Button className="w-full gradient-primary text-primary-foreground shadow-glow">
                    Anmelden & Kaufen
                  </Button>
                </Link>
                <p className="text-xs text-center text-muted-foreground">
                  Bereits ein Konto? Melde dich an, um deine Lizenzen zu nutzen.
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BenefitItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <CheckCircle className="h-4 w-4 text-primary flex-shrink-0" />
      <span className="text-foreground">{children}</span>
    </div>
  );
}
