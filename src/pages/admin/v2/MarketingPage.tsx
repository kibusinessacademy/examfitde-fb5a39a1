import { lazy, Suspense, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Tag, BarChart3, Megaphone } from 'lucide-react';

const PromoCodesPanel = lazy(() => import('@/components/admin/marketing/AdminPromoCodesPanel'));

const Loading = () => <Skeleton className="h-64 w-full" />;

export default function MarketingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Marketing</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Promo-Codes, Kampagnen & Aktionen</p>
      </div>

      <Tabs defaultValue="promo-codes" className="w-full">
        <TabsList>
          <TabsTrigger value="promo-codes" className="gap-1.5 text-xs">
            <Tag className="h-3.5 w-3.5" /> Promo-Codes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="promo-codes">
          <Suspense fallback={<Loading />}>
            <PromoCodesPanel />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
