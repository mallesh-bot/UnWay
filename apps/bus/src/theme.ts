export const C = {
  ink: "#1E2A32",
  ink2: "#3A4A55",
  ink3: "#6B7A85",
  line: "#DDE3E7",
  surface: "#F3F5F6",
  white: "#FFFFFF",
  bus: "#F2B705",
  busDeep: "#C99400",
  safe: "#1F8A5B",
  safeSoft: "#E3F3EB",
  alert: "#C8372D",
  alertSoft: "#FBE7E5",
  warn: "#B86E00",
  warnSoft: "#FDF1DC",
  route: "#2F6FB0",
  routeSoft: "#E5EEF8",
};

export const STATE_COLOR: Record<string, string> = {
  EXPECTED: C.ink3, ABSENT_NOTIFIED: C.ink3, ON_BOARD: C.route, DROPPED: C.safe, HANDED_OVER: C.safe,
  MISSED: C.alert, NO_SHOW: C.warn, UNCONFIRMED: C.alert, TRANSFERRED: C.ink3,
};
