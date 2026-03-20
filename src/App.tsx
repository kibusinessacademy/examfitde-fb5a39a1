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

function AppChrome() {
  const { isNative } = useNativeApp();
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin');
  const showNativeTabBar = isNative && !isAdminRoute;

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
);

export default App;
