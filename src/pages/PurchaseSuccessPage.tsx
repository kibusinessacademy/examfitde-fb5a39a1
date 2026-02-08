import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useVerifyPurchase } from '@/hooks/useShop';
import { useAuth } from '@/hooks/useAuth';
import { CheckCircle, Copy, Loader2, Package, GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface Seat {
  id: string;
  invite_code: string | null;
  assigned_user_id: string | null;
}

interface PurchaseResult {
  success: boolean;
  package_id: string;
  seats: Seat[];
  expires_at: string;
  already_processed?: boolean;
}

export default function PurchaseSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = searchParams.get('session_id');
  const { verifyPurchase, isLoading } = useVerifyPurchase();
  const { user, loading: authLoading } = useAuth();
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionId && user && !authLoading) {
      verifyPurchase(sessionId)
        .then(setResult)
        .catch((err) => setError(err.message));
    }
  }, [sessionId, user, authLoading]);

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success('Einladungscode kopiert!');
  };

  // Simple header for standalone page
  const PageHeader = () => (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center">
        <Link to="/" className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-primary">
            <GraduationCap className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-semibold">H5P Lernplattform</span>
        </Link>
      </div>
    </header>
  );

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader />
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">Fehlende Session</h1>
          <p className="text-muted-foreground mb-6">
            Keine Zahlungssession gefunden.
          </p>
          <Button onClick={() => navigate('/')}>Zur Startseite</Button>
        </div>
      </div>
    );
  }

  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader />
        <div className="container py-12 flex flex-col items-center justify-center min-h-[50vh]">
          <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Kauf wird verifiziert...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader />
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold text-destructive mb-4">Fehler</h1>
          <p className="text-muted-foreground mb-6">{error}</p>
          <Button onClick={() => navigate('/')}>Zur Startseite</Button>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const unassignedSeats = result.seats.filter(s => s.invite_code && !s.assigned_user_id);
  const expiresDate = new Date(result.expires_at).toLocaleDateString('de-DE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="min-h-screen bg-background">
      <PageHeader />
      <div className="container py-12 max-w-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <CheckCircle className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Kauf erfolgreich!</h1>
          <p className="text-muted-foreground">
            Vielen Dank für Ihren Einkauf. Sie haben nun Zugang zu Ihren Lerninhalten.
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              Ihre Lizenzen
            </CardTitle>
            <CardDescription>
              Gültig bis: {expiresDate}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-primary/5 rounded-lg border border-primary/20">
              <div>
                <p className="font-medium">Ihre Lizenz</p>
                <p className="text-sm text-muted-foreground">Automatisch aktiviert</p>
              </div>
              <Badge className="bg-primary">Aktiv</Badge>
            </div>

            {unassignedSeats.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-medium text-sm text-muted-foreground">
                  Weitere Lizenzen zum Verteilen ({unassignedSeats.length})
                </h3>
                {unassignedSeats.map(seat => (
                  <div 
                    key={seat.id} 
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                  >
                    <div className="font-mono text-lg tracking-wider">
                      {seat.invite_code}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyInviteCode(seat.invite_code!)}
                    >
                      <Copy className="w-4 h-4 mr-1" />
                      Kopieren
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Teilen Sie diese Codes mit Ihren Teilnehmern. 
                  Jeder Code kann nur einmal eingelöst werden.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-4 justify-center">
          <Button onClick={() => navigate('/dashboard')}>
            Zum Dashboard
          </Button>
          <Button variant="outline" onClick={() => navigate('/courses')}>
            Kurse anzeigen
          </Button>
        </div>
      </div>
    </div>
  );
}
