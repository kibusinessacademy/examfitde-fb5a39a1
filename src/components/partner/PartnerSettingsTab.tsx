import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Mail, CreditCard, FileText } from 'lucide-react';

interface Props { partner: any; }

export function PartnerSettingsTab({ partner }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4" /> Kontodaten</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Partner-Typ</span><Badge variant="outline">{partner.partner_type === 'agency' ? 'Agentur' : 'Affiliate'}</Badge></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Firma</span><span>{partner.company_name || '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Kontaktperson</span><span>{partner.contact_name || '—'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Referral-Code</span><span className="font-mono">{partner.referral_code}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge variant={partner.status === 'active' ? 'default' : 'secondary'}>{partner.status}</Badge></div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Mail className="h-4 w-4" /> Kontakt</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">E-Mail</span><span>{partner.email || '—'}</span></div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><CreditCard className="h-4 w-4" /> Zahlungsdaten</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Methode</span><span>{partner.payout_method || 'Nicht konfiguriert'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Steuer-ID</span><span>{partner.tax_id || '—'}</span></div>
          <p className="text-xs text-muted-foreground mt-2">Zur Änderung kontaktiere bitte partner@examfit.de</p>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> Partner seit</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p>{new Date(partner.created_at).toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </CardContent>
      </Card>
    </div>
  );
}
