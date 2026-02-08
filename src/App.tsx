import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/hooks/useAuth";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { NativeTabBar } from "@/components/native/NativeTabBar";
import { useNativeApp } from "@/hooks/useNativeApp";
import AppRoutes from "@/routes/AppRoutes";

const queryClient = new QueryClient();

function AppContent() {
  const { isNative } = useNativeApp();
  
  return (
    <>
      <OfflineIndicator />
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
        <NativeTabBar />
      </BrowserRouter>
      <InstallPrompt />
      {/* Add bottom padding when native tab bar is visible */}
      {isNative && <div className="h-20" />}
    </>
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
