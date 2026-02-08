import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, X, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      
      // Show prompt after a delay (don't interrupt immediately)
      const dismissed = localStorage.getItem("pwa-prompt-dismissed");
      const lastDismissed = dismissed ? new Date(dismissed) : null;
      const daysSinceDismissed = lastDismissed 
        ? (Date.now() - lastDismissed.getTime()) / (1000 * 60 * 60 * 24)
        : Infinity;
      
      if (daysSinceDismissed > 7) {
        setTimeout(() => setShowPrompt(true), 30000); // 30 seconds
      }
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
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    localStorage.setItem("pwa-prompt-dismissed", new Date().toISOString());
    setShowPrompt(false);
  };

  if (isInstalled || !showPrompt || !deferredPrompt) {
    return null;
  }

  return (
    <div 
      className={cn(
        "fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96",
        "bg-card border border-border rounded-lg shadow-lg p-4 z-50",
        "animate-fade-in"
      )}
    >
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
        aria-label="Schließen"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
          <Smartphone className="h-6 w-6 text-primary" />
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm">ExamFit installieren</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Lerne auch offline! Installiere ExamFit für schnellen Zugriff ohne Datenvolumen.
          </p>
          
          <div className="flex gap-2 mt-3">
            <Button 
              size="sm" 
              onClick={handleInstall}
              className="btn-glow"
            >
              <Download className="h-4 w-4 mr-1" />
              Installieren
            </Button>
            <Button 
              size="sm" 
              variant="ghost"
              onClick={handleDismiss}
            >
              Später
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
