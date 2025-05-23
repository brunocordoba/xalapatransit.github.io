import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/pages/Home";
import RouteEditor from "@/pages/RouteEditor";
import RoutePlanner from "@/pages/RoutePlanner";
import NearbyStops from "@/pages/NearbyStops";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={RoutePlanner} />
      <Route path="/rutas" component={Home} />
      <Route path="/editor" component={RouteEditor} />
      <Route path="/planificador" component={RoutePlanner} />
      <Route path="/paradas-cercanas" component={NearbyStops} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
