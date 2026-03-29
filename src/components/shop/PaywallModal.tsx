import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { PaywallContent } from './PaywallContent';
import type { ResolvedPaywall } from '@/hooks/useResolvePaywall';

interface PaywallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paywall: ResolvedPaywall | null;
  isLoading?: boolean;
  onCheckout: () => void;
  onLogin?: () => void;
  isAuthenticated?: boolean;
}

export function PaywallModal({
  open,
  onOpenChange,
  paywall,
  isLoading,
  onCheckout,
  onLogin,
  isAuthenticated = false,
}: PaywallModalProps) {
  const isMobile = useMediaQuery('(max-width: 640px)');

  const content = (
    <PaywallContent
      paywall={paywall}
      isLoading={isLoading}
      onCheckout={onCheckout}
      onLogin={onLogin}
      isAuthenticated={isAuthenticated}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto px-4 pb-8">
          <SheetHeader className="sr-only">
            <SheetTitle>Premium freischalten</SheetTitle>
            <SheetDescription>Wähle dein Paket</SheetDescription>
          </SheetHeader>
          {/* Drag handle */}
          <div className="flex justify-center pt-2 pb-4">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Premium freischalten</DialogTitle>
          <DialogDescription>Wähle dein Paket</DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
