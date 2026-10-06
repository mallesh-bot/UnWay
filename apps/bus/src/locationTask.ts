// Background GPS (Android foreground service). Runs while a trip is active,
// even when the screen is off. Points are stored offline then uploaded.
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { kvGet, pushLocations } from "./db";
import { flushLocations, setFix } from "./sync";

export const LOCATION_TASK = "unway-location";

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const tripId = kvGet<string>("active_trip_id");
  const points = data.locations.map((l) => ({
    ts: new Date(l.timestamp).toISOString(),
    lat: l.coords.latitude, lng: l.coords.longitude, acc: l.coords.accuracy,
    speed: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
    heading: l.coords.heading != null && l.coords.heading >= 0 ? l.coords.heading : null,
  }));
  pushLocations(tripId, points);
  const last = data.locations[data.locations.length - 1];
  setFix({ lat: last.coords.latitude, lng: last.coords.longitude, acc: last.coords.accuracy, speed: last.coords.speed, heading: last.coords.heading, ts: last.timestamp });
  await flushLocations();
});

export async function startTracking(busNumber: string): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== "granted") return false;
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (running) return true;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 5000,
    distanceInterval: 15,
    deferredUpdatesInterval: 5000,
    foregroundService: {
      notificationTitle: `UnWay · Bus ${busNumber} trip running`,
      notificationBody: "Sharing bus location with the school",
      notificationColor: "#F2B705",
      killServiceOnDestroy: false,
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });
  return true;
}

export async function stopTracking() {
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  await flushLocations(true);
}
