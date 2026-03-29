import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useCreateSalesLead, type PricingPlan } from '@/hooks/usePricingPlans';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PricingPlan | null;
  productId: string;
}

export function EnterpriseLeadDialog({ open, onOpenChange, plan, productId }: Props) {
  const [orgName, setOrgName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [seatCount, setSeatCount] = useState('');
  const [message, setMessage] = useState('');
  const createLead = useCreateSalesLead();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createLead.mutateAsync({
        orgName,
        contactName,
        contactEmail,
        productId,
        planKey: plan?.plan_key,
        seatCount: seatCount ? parseInt(seatCount, 10) : undefined,
        message,
      });
      toast.success('Anfrage gesendet! Wir melden uns in Kürze.');
      onOpenChange(false);
      setOrgName('');
      setContactName('');
      setContactEmail('');
      setSeatCount('');
      setMessage('');
    } catch {
      toast.error('Fehler beim Senden. Bitte versuchen Sie es erneut.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enterprise-Angebot anfragen</DialogTitle>
          <DialogDescription>
            Individuelles Angebot für größere Organisationen, Schulträger und Institutionen.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="orgName">Organisation</Label>
            <Input
              id="orgName"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Firma / Schule / Institution"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="contactName">Name</Label>
              <Input
                id="contactName"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="contactEmail">E-Mail</Label>
              <Input
                id="contactEmail"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <Label htmlFor="seatCount">Gewünschte Anzahl Seats</Label>
            <Input
              id="seatCount"
              type="number"
              min="1"
              value={seatCount}
              onChange={(e) => setSeatCount(e.target.value)}
              placeholder="z.B. 50"
            />
          </div>
          <div>
            <Label htmlFor="message">Nachricht (optional)</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Besondere Anforderungen, LTI/SCORM, ..."
            />
          </div>
          <Button type="submit" className="w-full" disabled={createLead.isPending}>
            {createLead.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Anfrage senden
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
