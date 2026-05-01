import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Download, ExternalLink } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export default function AppDownloadsPage() {
  const { user } = useAuth();
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['app-downloads', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, pdf_url, issued_at, created_at')
        .eq('user_id', user!.id)
        .not('pdf_url', 'is', null)
        .order('issued_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-text-primary flex items-center gap-2"><Download className="h-6 w-6" /> Downloads</h2>
      <p className="text-sm text-text-secondary">Aktuell: Rechnungs-PDFs. Weitere Lerninhalte folgen mit Signed-URLs.</p>

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-text-muted mx-auto mt-10" />
      ) : invoices.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-text-secondary">Keine Downloads verfügbar.</CardContent></Card>
      ) : (
        <div className="grid gap-2">
          {invoices.map((inv: any) => (
            <Card key={inv.id}>
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-text-primary">Rechnung {inv.invoice_number ?? inv.id.slice(0, 8)}</div>
                  <div className="text-xs text-text-muted">{new Date(inv.issued_at ?? inv.created_at).toLocaleDateString('de-DE')}</div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer">
                    PDF <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
