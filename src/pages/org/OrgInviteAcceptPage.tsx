import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2, CheckCircle2, XCircle, LogIn, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { acceptOrgInvite, getOrgInvitePreview } from "@/lib/orgConsoleApi";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface InvitePreview {
  email: string;
  role: string;
  org_id: string;
  org_name: string | null;
  product_title: string | null;
  status: string;
  expires_at: string;
}

export default function OrgInviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!token) return;
    // Public preview of the invite (read-only, no acceptance)
    (async () => {
      try {
        const { data, error } = await (supabase as any)
          .from("org_license_invites")
          .select(
            "email, role, org_id, status, expires_at, license_id, organizations!inner(name), org_licenses!inner(product_id, products(title))"
          )
          .eq("invite_token", token)
          .maybeSingle();
        if (error || !data) {
          setPreviewError("Einladung nicht gefunden oder bereits ungültig.");
          return;
        }
        setPreview({
          email: data.email,
          role: data.role,
          org_id: data.org_id,
          org_name: data.organizations?.name ?? null,
          product_title: data.org_licenses?.products?.title ?? null,
          status: data.status,
          expires_at: data.expires_at,
        });
      } catch (e: any) {
        setPreviewError(e?.message ?? "Fehler beim Laden der Einladung.");
      }
    })();
  }, [token]);

  async function handleAccept() {
    if (!token) return;
    if (!user) {
      // Redirect to auth with return URL
      const ret = encodeURIComponent(`/org/einladung/${token}`);
      navigate(`/auth?return=${ret}`);
      return;
    }
    setAccepting(true);
    try {
      const r = await acceptOrgInvite(token);
      if (r.ok) {
        setAccepted(true);
        toast.success("Einladung angenommen — willkommen!");
        setTimeout(() => {
          if (r.org_id) navigate(`/app/org/${r.org_id}`);
          else navigate("/app");
        }, 1500);
      } else {
        toast.error(`Annahme fehlgeschlagen: ${r.error}`);
      }
    } catch (e: any) {
      toast.error(`Fehler: ${e?.message}`);
    } finally {
      setAccepting(false);
    }
  }

  return (
    <>
      <Helmet>
        <title>Einladung annehmen · BerufOS</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="max-w-md w-full p-8 shadow-elev-3 border-border">
          <div className="flex justify-center mb-5">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Building2 className="h-7 w-7 text-primary" />
            </div>
          </div>

          {!token || previewError ? (
            <div className="text-center">
              <XCircle className="h-10 w-10 mx-auto mb-3 text-status-danger" />
              <h1 className="text-xl font-semibold text-text-primary mb-2">
                Einladung ungültig
              </h1>
              <p className="text-sm text-text-secondary mb-6">
                {previewError ?? "Kein Token vorhanden."}
              </p>
              <Button asChild variant="outline">
                <Link to="/">Zur Startseite</Link>
              </Button>
            </div>
          ) : !preview ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-3/4 mx-auto" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-10 w-full mt-4" />
            </div>
          ) : accepted ? (
            <div className="text-center">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-status-success" />
              <h1 className="text-xl font-semibold text-text-primary mb-2">
                Willkommen an Bord!
              </h1>
              <p className="text-sm text-text-secondary">
                Du wirst gleich zu deiner Organisation weitergeleitet…
              </p>
            </div>
          ) : preview.status !== "pending" ? (
            <div className="text-center">
              <XCircle className="h-10 w-10 mx-auto mb-3 text-status-warning" />
              <h1 className="text-xl font-semibold text-text-primary mb-2">
                Einladung nicht mehr aktiv
              </h1>
              <p className="text-sm text-text-secondary mb-2">Status: {preview.status}</p>
              <p className="text-sm text-text-tertiary mb-6">
                Bitte den Absender um eine neue Einladung.
              </p>
              <Button asChild variant="outline">
                <Link to="/">Zur Startseite</Link>
              </Button>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-text-primary mb-1 text-center">
                Du wurdest eingeladen
              </h1>
              <p className="text-sm text-text-secondary mb-5 text-center">
                Tritt der Organisation bei und erhalte sofortigen Zugriff.
              </p>

              <div className="bg-surface-1 rounded-lg p-4 space-y-2 mb-5 border border-border">
                <div className="flex justify-between text-sm">
                  <span className="text-text-tertiary">Organisation</span>
                  <span className="font-medium text-text-primary">
                    {preview.org_name ?? "—"}
                  </span>
                </div>
                {preview.product_title && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-tertiary">Kurs</span>
                    <span className="font-medium text-text-primary text-right max-w-[60%] truncate">
                      {preview.product_title}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-text-tertiary">Rolle</span>
                  <Badge variant="secondary">{preview.role}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-tertiary">E-Mail</span>
                  <span className="font-medium text-text-primary truncate max-w-[60%]">
                    {preview.email}
                  </span>
                </div>
              </div>

              {authLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : !user ? (
                <>
                  <Button onClick={handleAccept} className="w-full gap-2">
                    <LogIn className="h-4 w-4" />
                    Anmelden & Einladung annehmen
                  </Button>
                  <p className="text-xs text-text-tertiary text-center mt-3">
                    Bitte melde dich mit <strong>{preview.email}</strong> an, um die Einladung
                    anzunehmen.
                  </p>
                </>
              ) : user.email?.toLowerCase() !== preview.email.toLowerCase() ? (
                <>
                  <div className="bg-status-warning-bg-subtle text-status-warning rounded-lg p-3 text-sm mb-4">
                    Du bist als <strong>{user.email}</strong> angemeldet, die Einladung wurde aber
                    an <strong>{preview.email}</strong> gerichtet.
                  </div>
                  <Button
                    onClick={async () => {
                      await supabase.auth.signOut();
                      navigate(`/auth?return=${encodeURIComponent(`/org/einladung/${token}`)}`);
                    }}
                    variant="outline"
                    className="w-full"
                  >
                    Abmelden und neu anmelden
                  </Button>
                </>
              ) : (
                <Button
                  onClick={handleAccept}
                  disabled={accepting}
                  className="w-full gap-2"
                  size="lg"
                >
                  {accepting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Einladung annehmen
                </Button>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
