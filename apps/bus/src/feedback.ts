import * as Haptics from "expo-haptics";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";

let players: Record<string, AudioPlayer> | null = null;
function get() {
  if (!players) {
    players = {
      ok: createAudioPlayer(require("../assets/sounds/ok.wav")),
      warn: createAudioPlayer(require("../assets/sounds/warn.wav")),
      error: createAudioPlayer(require("../assets/sounds/error.wav")),
    };
  }
  return players;
}

export function feedback(kind: "ok" | "warn" | "error") {
  try {
    const p = get()[kind];
    void p.seekTo(0).then(() => p.play()).catch(() => p.play());
  } catch { /* audio unavailable */ }
  if (kind === "ok") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else if (kind === "warn") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  else void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}
