import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StoreProvider, useStore } from "./store";
import { C } from "./theme";
import type { TripSummary } from "./types";
import PairScreen from "./screens/PairScreen";
import HomeScreen from "./screens/HomeScreen";
import CrewScreen from "./screens/CrewScreen";
import TripScreen from "./screens/TripScreen";
import SettingsScreen from "./screens/SettingsScreen";
import { DoneScreen, EmptyBusCheckScreen, SosScreen } from "./screens/EndScreens";

type Route =
  | { name: "home" } | { name: "crew"; trip: TripSummary } | { name: "trip" } | { name: "ebc" }
  | { name: "done"; synced: boolean } | { name: "sos"; back: Route } | { name: "settings" };

function Router() {
  const { ready, config, trip, endTrip, startTrip, driverId, attendantId } = useStore();
  const [route, setRoute] = useState<Route>(trip?.trip.status === "active" ? { name: "trip" } : { name: "home" });

  // a paired device that loses its token falls back to the pairing screen automatically
  useEffect(() => { if (!config) setRoute({ name: "home" }); }, [config]);

  if (!ready) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.ink }}><ActivityIndicator color={C.bus} size="large" /></View>;
  if (!config) return <PairScreen />;

  const sos = () => setRoute({ name: "sos", back: route });
  switch (route.name) {
    case "crew":
      return <CrewScreen trip={route.trip} onBack={() => setRoute({ name: "home" })} onStarted={() => setRoute({ name: "trip" })} />;
    case "trip":
      return trip ? <TripScreen onSos={sos} onHome={() => setRoute({ name: "home" })} onFinish={() => setRoute({ name: "ebc" })} />
        : <HomeScreen onStart={(tr) => setRoute({ name: "crew", trip: tr })} onSos={sos} onSettings={() => setRoute({ name: "settings" })} onResume={() => setRoute({ name: "trip" })} />;
    case "ebc":
      return <EmptyBusCheckScreen onBack={() => setRoute({ name: "trip" })} onDone={async (synced) => { await endTrip(); setRoute({ name: "done", synced }); }} />;
    case "done":
      return <DoneScreen synced={route.synced} onHome={() => setRoute({ name: "home" })} />;
    case "sos":
      return <SosScreen onClose={() => setRoute(route.back)} />;
    case "settings":
      return <SettingsScreen onBack={() => setRoute({ name: "home" })} />;
    default:
      return <HomeScreen
        onStart={async (tr) => {
          // a trip already running on this bus (e.g. after reinstall) resumes with the same crew
          if (tr.status === "active" && driverId) { await startTrip(tr.id, driverId, attendantId ?? driverId); setRoute({ name: "trip" }); }
          else setRoute({ name: "crew", trip: tr });
        }}
        onSos={sos} onSettings={() => setRoute({ name: "settings" })} onResume={() => setRoute({ name: "trip" })} />;
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <StoreProvider>
        <Router />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
