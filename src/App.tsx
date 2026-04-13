import { useEffect } from "react";
import { detectAndTrackPartnerReferral } from "@/lib/tracking/partnerAttribution";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, useLocation } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/hooks/useAuth";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { NativeTabBar } from "@/components/native/NativeTabBar";
import { useNativeApp } from "@/hooks/useNativeApp";
import AppRoutes from "@/routes/AppRoutes";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

const OPEN_RADIX_MODAL_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
].join(", ");

function usePointerLockRecovery() {
  const location = useLocation();

  useEffect(() => {
    if (typeof document === "undefined") return;

    const unlockIfStale = () => {
      const hasOpenModal = !!document.querySelector(OPEN_RADIX_MODAL_SELECTOR);
      if (hasOpenModal) return;

      if (document.body.style.pointerEvents === "none") {
        document.body.style.pointerEvents = "";
      }

      if (document.documentElement.style.pointerEvents === "none") {
        document.documentElement.style.pointerEvents = "";
      }
    };

    unlockIfStale();

    const animationFrame = window.requestAnimationFrame(unlockIfStale);
    const timeout = window.setTimeout(unlockIfStale, 250);
    const observer = new MutationObserver(unlockIfStale);

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "data-state"],
    });

    document.addEventListener("focusin", unlockIfStale, true);
    document.addEventListener("pointerup", unlockIfStale, true);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
      observer.disconnect();
      document.removeEventListener("focusin", unlockIfStale, true);
      document.removeEventListener("pointerup", unlockIfStale, true);
      unlockIfStale();
    };
  }, [location.pathname]);
}

function AppChrome() {
  const { isNative } = useNativeApp();
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin');
  const showNativeTabBar = isNative && !isAdminRoute;

  usePointerLockRecovery();

  // Detect partner referral params on landing
  useEffect(() => {
    detectAndTrackPartnerReferral();
  }, []);

  return (
    <>
      <OfflineIndicator />
      <Toaster />
      <Sonner />
      <AppRoutes />
      {showNativeTabBar ? <NativeTabBar /> : null}
      <InstallPrompt />
      {showNativeTabBar ? <div className="h-20" /> : null}
    </>
  );
}

function AppContent() {
  return (
    <BrowserRouter>
      <AppChrome />
    </BrowserRouter>
  );
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange={false}
      >
        <TooltipProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
