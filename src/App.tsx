import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Chat from "./pages/Chat";
import Chats from "./pages/Chats";
import Profile from "./pages/Profile";
import BottomNavigation from "./components/BottomNavigation";
import NotFound from "./pages/NotFound";
import { useReferral } from "./hooks/useReferral";
import GlobalHeader from "./components/GlobalHeader";

const queryClient = new QueryClient();

const App = () => {
  // Capture referrals and apply once user authenticates
  // (No UI impact; lightweight hook)
  useReferral();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <div className="min-h-screen pb-16">
          <GlobalHeader />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/chat/:languageId" element={<Chat />} />
            <Route path="/chats" element={<Chats />} />
            <Route path="/profile" element={<Profile />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          <BottomNavigation />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
