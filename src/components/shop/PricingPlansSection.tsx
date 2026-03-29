import { useState } from 'react';
import { usePricingPlans, type PricingPlan } from '@/hooks/usePricingPlans';
import { useStartCheckout } from '@/hooks/useStartCheckout';
import { PricingPlanCard } from './PricingPlanCard';
import { EnterpriseLeadDialog } from './EnterpriseLeadDialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';

interface PricingPlansProps {
  productId: string;
  defaultTab?: 'b2c' | 'b2b';
}

export function PricingPlansSection({ productId, defaultTab = 'b2b' }: PricingPlansProps) {
  const { data: plans, isLoading } = usePricingPlans(productId);
  const checkout = useStartCheckout();
  const [leadPlan, setLeadPlan] = useState<PricingPlan | null>(null);

  const b2cPlans = (plans || []).filter((p) => p.audience_type === 'b2c');
  const b2bPlans = (plans || []).filter((p) => p.audience_type === 'b2b');

  const handleCheckout = (plan: PricingPlan) => {
    checkout.mutate({
      productId,
      pricingPlanId: plan.id,
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
          Bestehensquoten erhöhen. Prüfungsreife sichtbar machen.
        </h2>
        <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
          Strukturierte Prüfungsvorbereitung für Einzelpersonen und Ausbildungsbetriebe.
        </p>
      </div>

      <Tabs defaultValue={defaultTab} className="w-full">
        <div className="flex justify-center">
          <TabsList>
            <TabsTrigger value="b2c">Einzelpersonen</TabsTrigger>
            <TabsTrigger value="b2b">Für Betriebe</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="b2c" className="mt-8">
          <div className="max-w-md mx-auto">
            {b2cPlans.map((plan) => (
              <PricingPlanCard
                key={plan.id}
                plan={plan}
                onCheckout={handleCheckout}
                onContactSales={setLeadPlan}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="b2b" className="mt-8">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 max-w-6xl mx-auto items-start">
            {b2bPlans.map((plan) => (
              <PricingPlanCard
                key={plan.id}
                plan={plan}
                onCheckout={handleCheckout}
                onContactSales={setLeadPlan}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <EnterpriseLeadDialog
        open={!!leadPlan}
        onOpenChange={(open) => !open && setLeadPlan(null)}
        plan={leadPlan}
        productId={productId}
      />
    </div>
  );
}
