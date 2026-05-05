import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Download, 
  Smartphone, 
  WifiOff, 
  Zap, 
  Bell,
  CheckCircle,
  Share,
  PlusSquare
} from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export default function InstallPage() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    // Check if iOS
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(isIOSDevice);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    
    setDeferredPrompt(null);
  };

  const features = [
    {
      icon: WifiOff,
      title: "Offline lernen",
      description: "Lerne unterwegs ohne Datenvolumen – alle Inhalte werden gespeichert."
    },
    {
      icon: Zap,
      title: "Blitzschnell",
      description: "Direkter Zugriff vom Homescreen – schneller als jede Website."
    },
    {
      icon: Bell,
      title: "Erinnerungen",
      description: "Erhalte Lern-Erinnerungen und verpasse keine Prüfungstermine."
    },
    {
      icon: Smartphone,
      title: "Vollbild-Erlebnis",
      description: "Keine Browserleiste – fokussiertes Lernen wie in einer echten App."
    }
  ];

  if (isInstalled) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="mx-auto w-16 h-16 bg-success-bg-subtle rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="h-8 w-8 text-success" />
            </div>
            <CardTitle>ExamFit ist installiert!</CardTitle>
            <CardDescription>
              Du kannst die App jetzt direkt von deinem Homescreen starten.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <a href="/">Zum Lernen</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="gradient-hero text-white py-16 md:py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 rounded-full px-4 py-2 mb-6">
            <Download className="h-4 w-4" />
            <span className="text-sm font-medium">Kostenlos installieren</span>
          </div>
          
          <h1 className="text-3xl md:text-5xl font-bold mb-4">
            ExamFit als App installieren
          </h1>
          <p className="text-lg md:text-xl opacity-90 max-w-2xl mx-auto mb-8">
            Lerne auch ohne Internet. Installiere ExamFit auf deinem Gerät für 
            schnellen Zugriff und Offline-Funktionen.
          </p>

          {deferredPrompt ? (
            <Button 
              size="lg" 
              variant="secondary"
              onClick={handleInstall}
              className="text-lg px-8 py-6"
            >
              <Download className="h-5 w-5 mr-2" />
              Jetzt installieren
            </Button>
          ) : isIOS ? (
            <div className="bg-white/10 rounded-lg p-6 max-w-md mx-auto">
              <p className="font-medium mb-4">So installierst du ExamFit auf iOS:</p>
              <ol className="text-left space-y-3 text-sm">
                <li className="flex items-start gap-3">
                  <span className="bg-white/20 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 text-xs font-bold">1</span>
                  <span>Tippe auf <Share className="inline h-4 w-4 mx-1" /> (Teilen) in der Safari-Leiste</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="bg-white/20 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 text-xs font-bold">2</span>
                  <span>Scrolle und wähle <PlusSquare className="inline h-4 w-4 mx-1" /> "Zum Home-Bildschirm"</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="bg-white/20 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 text-xs font-bold">3</span>
                  <span>Tippe auf "Hinzufügen" – fertig!</span>
                </li>
              </ol>
            </div>
          ) : (
            <p className="text-sm opacity-75">
              Die Installation ist in deinem Browser möglicherweise nicht verfügbar.
              <br />
              Versuche es mit Chrome, Edge oder Samsung Internet.
            </p>
          )}
        </div>
      </div>

      {/* Features */}
      <div className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
            Warum ExamFit installieren?
          </h2>
          
          <div className="grid sm:grid-cols-2 gap-6">
            {features.map((feature) => (
              <Card key={feature.title} className="card-interactive">
                <CardHeader className="pb-2">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                    <feature.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-sm">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-16 px-4 bg-muted/50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4">
            Bereit zum Lernen?
          </h2>
          <p className="text-muted-foreground mb-8">
            Auch ohne Installation kannst du ExamFit jetzt direkt nutzen.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg">
              <a href="/dashboard">Zum Dashboard</a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="/berufe">Berufe entdecken</a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
