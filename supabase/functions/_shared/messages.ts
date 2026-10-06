// Message texts for parent & staff notifications (English, Hindi, Telugu).
// Used for Telegram, Web Push and WhatsApp free-form text. WhatsApp *template*
// mode maps the same events to pre-approved templates (see whatsapp.ts).

export type Lang = "en" | "hi" | "te";

export interface OutboxRow {
  id: string;
  event_type: string;
  channel: "whatsapp" | "telegram" | "webpush" | "email";
  address: string;
  language: string;
  recipient_type: "guardian" | "staff";
  payload: Record<string, unknown>;
}

type P = Record<string, string>;

const T: Record<Lang, Record<string, (p: P) => string>> = {
  en: {
    BOARDED: (p) => `✅ ${p.student_first_name} boarded Bus ${p.bus}${p.stop ? ` at ${p.stop}` : ""} at ${p.time}.`,
    REACHED_SCHOOL: (p) => `🏫 ${p.student_first_name} reached school at ${p.time} (Bus ${p.bus}).`,
    BOARDED_RETURN: (p) => `🚌 ${p.student_first_name} boarded Bus ${p.bus} at school at ${p.time} for the trip home.`,
    DROPPED: (p) => `🏠 ${p.student_first_name} was dropped${p.stop ? ` at ${p.stop}` : ""} at ${p.time} (Bus ${p.bus}).${p.handover ? ` Handed over to: ${p.handover}.` : ""}`,
    MISSED_BOARDING: (p) => `⚠️ ${p.student_first_name} did not board Bus ${p.bus}${p.stop ? ` at ${p.stop}` : ""} this morning (${p.time}). If this is unexpected, please call the school${p.desk_phone ? `: ${p.desk_phone}` : ""}.`,
    NOT_BOARDED_RETURN: (p) => `⚠️ ${p.student_first_name} has not boarded Bus ${p.bus} for the trip home (${p.time}). The school transport team has been informed.${p.desk_phone ? ` School: ${p.desk_phone}` : ""}`,
    KEPT_ON_BUS: (p) => `ℹ️ No guardian was at the stop, so ${p.student_first_name} is safe on Bus ${p.bus} and will be brought back to school. Please call${p.desk_phone ? ` ${p.desk_phone}` : " the school"}.`,
    BUS_CHANGED: (p) => `ℹ️ ${p.student_first_name} is travelling on Bus ${p.bus} today${p.usual_bus ? ` instead of Bus ${p.usual_bus}` : ""}.`,
    INCIDENT: (p) => `📢 Update from ${p.school} about Bus ${p.bus}: ${p.message}`,
    DROP_UNCONFIRMED: (p) => `ℹ️ We could not confirm ${p.student_first_name}'s drop-off on Bus ${p.bus}. The school is checking.${p.desk_phone ? ` School: ${p.desk_phone}` : ""}`,
    WELCOME: (p) => `Hello ${p.guardian_name}, ${p.school} uses UnWay for school transport. You will get updates here when ${p.children} board and leave the bus. Reply YES to confirm or STOP to opt out.`,
    TRACK: (p) => `Track live: ${p.url}`,
    SOS: (p) => `🚨 SOS from Bus ${p.bus}: ${p.type}${p.note ? ` (${p.note})` : ""} at ${p.time}. Children on board: ${p.on_board}. Location: ${p.map}`,
    LINKED: (p) => `✅ Linked! You will receive ${p.school} bus updates for ${p.children} here.\n\nCommands:\nSTATUS – where is my child\nABSENT – no bus tomorrow (ABSENT TODAY / ABSENT PM)\nHELP – school contact\nSTOP – unsubscribe`,
    STAFF_LINKED: (p) => `✅ This chat will receive SOS and safety alerts for ${p.school}.`,
    BAD_CODE: () => `This link is not valid. Please ask the school for a new invite.`,
    UNKNOWN: () => `We could not find your number. Please open the invite link from your school to connect.`,
    STOPPED: () => `You have been unsubscribed. Send START to subscribe again.`,
    STARTED: () => `You are subscribed to bus updates.`,
    ABSENT: (p) => `Noted: ${p.child} will not take the bus ${p.when}${p.legs !== "BOTH" ? ` (${p.legs})` : ""}.`,
    HELP: (p) => `Commands: STATUS, ABSENT, ABSENT TODAY, ABSENT PM, STOP.${p.desk_phone ? `\nSchool transport desk: ${p.desk_phone}` : ""}`,
    STATUS_NONE: (p) => `${p.child}: no bus trip today.`,
    STATUS: (p) => `${p.child}: ${p.state_text}${p.bus ? ` (Bus ${p.bus})` : ""}`,
    APPROACHING: (p) => `⏱️ Bus ${p.bus} is about ${p.minutes} min from ${p.stop}. Please get ${p.student_first_name} ready.`,
    ESCALATION: (p) => `🔺 Still open after ${p.minutes} min — Bus ${p.bus}: ${p.message}. Please act on the dashboard.`,
    DAILY_SUMMARY: (p) => `📊 ${p.school} · ${p.date}\nTrips: ${p.completed}/${p.trips} completed${Number(p.not_completed) ? `, ${p.not_completed} not completed` : ""}${Number(p.late_starts) ? `, ${p.late_starts} late starts` : ""}\nRiders dropped safely: ${p.riders}${Number(p.missed) ? `\nMissed / unconfirmed: ${p.missed}` : ""}\nOpen alerts: ${p.open_exceptions}\nParent messages sent: ${p.messages}`,
    PORTAL: (p) => `Your parent dashboard (routes, history, absences): ${p.url}`,
    today: () => "today",
    tomorrow: () => "tomorrow",
  },
  hi: {
    BOARDED: (p) => `✅ ${p.student_first_name} ${p.time} बजे${p.stop ? ` ${p.stop} पर` : ""} बस ${p.bus} में चढ़ गए।`,
    REACHED_SCHOOL: (p) => `🏫 ${p.student_first_name} ${p.time} बजे स्कूल पहुँच गए (बस ${p.bus})।`,
    BOARDED_RETURN: (p) => `🚌 ${p.student_first_name} ${p.time} बजे घर जाने के लिए स्कूल से बस ${p.bus} में चढ़ गए।`,
    DROPPED: (p) => `🏠 ${p.student_first_name} को ${p.time} बजे${p.stop ? ` ${p.stop} पर` : ""} उतारा गया (बस ${p.bus})।${p.handover ? ` सौंपा गया: ${p.handover}।` : ""}`,
    MISSED_BOARDING: (p) => `⚠️ ${p.student_first_name} आज सुबह${p.stop ? ` ${p.stop} पर` : ""} बस ${p.bus} में नहीं चढ़े (${p.time})। अगर यह अपेक्षित नहीं है तो कृपया स्कूल को कॉल करें${p.desk_phone ? `: ${p.desk_phone}` : ""}।`,
    NOT_BOARDED_RETURN: (p) => `⚠️ ${p.student_first_name} घर जाने वाली बस ${p.bus} में नहीं चढ़े (${p.time})। स्कूल परिवहन टीम को सूचित कर दिया गया है।${p.desk_phone ? ` स्कूल: ${p.desk_phone}` : ""}`,
    KEPT_ON_BUS: (p) => `ℹ️ स्टॉप पर कोई अभिभावक नहीं था, इसलिए ${p.student_first_name} बस ${p.bus} में सुरक्षित हैं और स्कूल वापस लाए जाएँगे। कृपया कॉल करें${p.desk_phone ? ` ${p.desk_phone}` : ""}।`,
    BUS_CHANGED: (p) => `ℹ️ ${p.student_first_name} आज${p.usual_bus ? ` बस ${p.usual_bus} की जगह` : ""} बस ${p.bus} से यात्रा कर रहे हैं।`,
    INCIDENT: (p) => `📢 ${p.school} की ओर से बस ${p.bus} के बारे में सूचना: ${p.message}`,
    DROP_UNCONFIRMED: (p) => `ℹ️ बस ${p.bus} से ${p.student_first_name} के उतरने की पुष्टि नहीं हो सकी। स्कूल जाँच कर रहा है।${p.desk_phone ? ` स्कूल: ${p.desk_phone}` : ""}`,
    WELCOME: (p) => `नमस्ते ${p.guardian_name}, ${p.school} स्कूल परिवहन के लिए UnWay का उपयोग करता है। ${p.children} के बस में चढ़ने और उतरने पर आपको यहाँ सूचना मिलेगी। पुष्टि के लिए YES भेजें, बंद करने के लिए STOP।`,
    TRACK: (p) => `लाइव ट्रैक करें: ${p.url}`,
    SOS: (p) => `🚨 बस ${p.bus} से SOS: ${p.type}${p.note ? ` (${p.note})` : ""} ${p.time}। बस में बच्चे: ${p.on_board}। स्थान: ${p.map}`,
    LINKED: (p) => `✅ जुड़ गया! ${p.children} के लिए ${p.school} की बस सूचनाएँ आपको यहाँ मिलेंगी।\n\nकमांड:\nSTATUS – बच्चा कहाँ है\nABSENT – कल बस नहीं (ABSENT TODAY / ABSENT PM)\nHELP – स्कूल संपर्क\nSTOP – बंद करें`,
    STAFF_LINKED: (p) => `✅ इस चैट में ${p.school} के SOS और सुरक्षा अलर्ट आएँगे।`,
    BAD_CODE: () => `यह लिंक मान्य नहीं है। कृपया स्कूल से नया लिंक माँगें।`,
    UNKNOWN: () => `आपका नंबर नहीं मिला। कृपया स्कूल का भेजा हुआ लिंक खोलें।`,
    STOPPED: () => `आपकी सदस्यता बंद कर दी गई है। फिर से शुरू करने के लिए START भेजें।`,
    STARTED: () => `आपको बस सूचनाएँ मिलती रहेंगी।`,
    ABSENT: (p) => `नोट किया: ${p.child} ${p.when} बस से नहीं जाएँगे${p.legs !== "BOTH" ? ` (${p.legs})` : ""}।`,
    HELP: (p) => `कमांड: STATUS, ABSENT, ABSENT TODAY, ABSENT PM, STOP।${p.desk_phone ? `\nस्कूल परिवहन डेस्क: ${p.desk_phone}` : ""}`,
    STATUS_NONE: (p) => `${p.child}: आज कोई बस यात्रा नहीं।`,
    STATUS: (p) => `${p.child}: ${p.state_text}${p.bus ? ` (बस ${p.bus})` : ""}`,
    APPROACHING: (p) => `⏱️ बस ${p.bus} ${p.stop} से लगभग ${p.minutes} मिनट दूर है। कृपया ${p.student_first_name} को तैयार रखें।`,
    ESCALATION: (p) => `🔺 ${p.minutes} मिनट से खुला — बस ${p.bus}: ${p.message}। कृपया डैशबोर्ड पर कार्रवाई करें।`,
    DAILY_SUMMARY: (p) => `📊 ${p.school} · ${p.date}\nयात्राएँ: ${p.completed}/${p.trips} पूरी\nसुरक्षित उतारे गए: ${p.riders}\nछूटे / अपुष्ट: ${p.missed}\nखुले अलर्ट: ${p.open_exceptions}\nभेजे गए संदेश: ${p.messages}`,
    PORTAL: (p) => `आपका अभिभावक डैशबोर्ड (रूट, इतिहास, छुट्टी): ${p.url}`,
    today: () => "आज",
    tomorrow: () => "कल",
  },
  te: {
    BOARDED: (p) => `✅ ${p.student_first_name} ${p.time}కి${p.stop ? ` ${p.stop} వద్ద` : ""} బస్ ${p.bus} ఎక్కారు.`,
    REACHED_SCHOOL: (p) => `🏫 ${p.student_first_name} ${p.time}కి స్కూల్ చేరుకున్నారు (బస్ ${p.bus}).`,
    BOARDED_RETURN: (p) => `🚌 ${p.student_first_name} ${p.time}కి ఇంటికి వెళ్ళడానికి స్కూల్ వద్ద బస్ ${p.bus} ఎక్కారు.`,
    DROPPED: (p) => `🏠 ${p.student_first_name} ను ${p.time}కి${p.stop ? ` ${p.stop} వద్ద` : ""} దించారు (బస్ ${p.bus}).${p.handover ? ` అప్పగించింది: ${p.handover}.` : ""}`,
    MISSED_BOARDING: (p) => `⚠️ ${p.student_first_name} ఈ ఉదయం${p.stop ? ` ${p.stop} వద్ద` : ""} బస్ ${p.bus} ఎక్కలేదు (${p.time}). ఇది అనుకోనిదైతే దయచేసి స్కూల్‌కు కాల్ చేయండి${p.desk_phone ? `: ${p.desk_phone}` : ""}.`,
    NOT_BOARDED_RETURN: (p) => `⚠️ ${p.student_first_name} ఇంటికి వెళ్ళే బస్ ${p.bus} ఎక్కలేదు (${p.time}). స్కూల్ ట్రాన్స్‌పోర్ట్ టీమ్‌కు తెలియజేశాం.${p.desk_phone ? ` స్కూల్: ${p.desk_phone}` : ""}`,
    KEPT_ON_BUS: (p) => `ℹ️ స్టాప్ వద్ద తల్లిదండ్రులు లేనందున ${p.student_first_name} బస్ ${p.bus}లో సురక్షితంగా ఉన్నారు, స్కూల్‌కు తిరిగి తీసుకువస్తాం. దయచేసి కాల్ చేయండి${p.desk_phone ? ` ${p.desk_phone}` : ""}.`,
    BUS_CHANGED: (p) => `ℹ️ ${p.student_first_name} ఈరోజు${p.usual_bus ? ` బస్ ${p.usual_bus}కి బదులుగా` : ""} బస్ ${p.bus}లో ప్రయాణిస్తున్నారు.`,
    INCIDENT: (p) => `📢 బస్ ${p.bus} గురించి ${p.school} నుండి సమాచారం: ${p.message}`,
    DROP_UNCONFIRMED: (p) => `ℹ️ బస్ ${p.bus} నుండి ${p.student_first_name} దిగినట్లు నిర్ధారించలేకపోయాం. స్కూల్ తనిఖీ చేస్తోంది.${p.desk_phone ? ` స్కూల్: ${p.desk_phone}` : ""}`,
    WELCOME: (p) => `నమస్తే ${p.guardian_name}, ${p.school} స్కూల్ ట్రాన్స్‌పోర్ట్ కోసం UnWay ఉపయోగిస్తోంది. ${p.children} బస్ ఎక్కినప్పుడు, దిగినప్పుడు మీకు ఇక్కడ సమాచారం వస్తుంది. నిర్ధారించడానికి YES, ఆపడానికి STOP పంపండి.`,
    TRACK: (p) => `లైవ్ ట్రాక్: ${p.url}`,
    SOS: (p) => `🚨 బస్ ${p.bus} నుండి SOS: ${p.type}${p.note ? ` (${p.note})` : ""} ${p.time}. బస్‌లో పిల్లలు: ${p.on_board}. లొకేషన్: ${p.map}`,
    LINKED: (p) => `✅ కనెక్ట్ అయింది! ${p.children} కోసం ${p.school} బస్ సమాచారం మీకు ఇక్కడ వస్తుంది.\n\nకమాండ్లు:\nSTATUS – పిల్లలు ఎక్కడ ఉన్నారు\nABSENT – రేపు బస్ లేదు (ABSENT TODAY / ABSENT PM)\nHELP – స్కూల్ కాంటాక్ట్\nSTOP – ఆపండి`,
    STAFF_LINKED: (p) => `✅ ఈ చాట్‌కు ${p.school} SOS మరియు భద్రతా అలర్ట్‌లు వస్తాయి.`,
    BAD_CODE: () => `ఈ లింక్ చెల్లదు. దయచేసి స్కూల్ నుండి కొత్త లింక్ అడగండి.`,
    UNKNOWN: () => `మీ నంబర్ కనబడలేదు. దయచేసి స్కూల్ పంపిన లింక్ తెరవండి.`,
    STOPPED: () => `మీ సబ్‌స్క్రిప్షన్ ఆపేశాం. మళ్ళీ మొదలు పెట్టడానికి START పంపండి.`,
    STARTED: () => `మీకు బస్ సమాచారం వస్తుంది.`,
    ABSENT: (p) => `నమోదు చేశాం: ${p.child} ${p.when} బస్‌లో రారు${p.legs !== "BOTH" ? ` (${p.legs})` : ""}.`,
    HELP: (p) => `కమాండ్లు: STATUS, ABSENT, ABSENT TODAY, ABSENT PM, STOP.${p.desk_phone ? `\nస్కూల్ ట్రాన్స్‌పోర్ట్ డెస్క్: ${p.desk_phone}` : ""}`,
    STATUS_NONE: (p) => `${p.child}: ఈరోజు బస్ ట్రిప్ లేదు.`,
    STATUS: (p) => `${p.child}: ${p.state_text}${p.bus ? ` (బస్ ${p.bus})` : ""}`,
    APPROACHING: (p) => `⏱️ బస్ ${p.bus} ${p.stop}కి సుమారు ${p.minutes} నిమిషాల దూరంలో ఉంది. దయచేసి ${p.student_first_name}ని సిద్ధంగా ఉంచండి.`,
    ESCALATION: (p) => `🔺 ${p.minutes} నిమిషాలుగా పరిష్కరించలేదు — బస్ ${p.bus}: ${p.message}. దయచేసి డ్యాష్‌బోర్డ్‌లో చర్య తీసుకోండి.`,
    DAILY_SUMMARY: (p) => `📊 ${p.school} · ${p.date}\nట్రిప్‌లు: ${p.completed}/${p.trips} పూర్తి\nసురక్షితంగా దించినవారు: ${p.riders}\nమిస్ / నిర్ధారణ కానివి: ${p.missed}\nఓపెన్ అలర్ట్‌లు: ${p.open_exceptions}\nపంపిన సందేశాలు: ${p.messages}`,
    PORTAL: (p) => `మీ పేరెంట్ డ్యాష్‌బోర్డ్ (రూట్‌లు, చరిత్ర, సెలవులు): ${p.url}`,
    today: () => "ఈరోజు",
    tomorrow: () => "రేపు",
  },
};

const STATE_TEXT: Record<Lang, Record<string, string>> = {
  en: {
    EXPECTED: "waiting for the bus", ON_BOARD: "on the bus", DROPPED: "dropped off", HANDED_OVER: "handed over",
    MISSED: "did not board", NO_SHOW: "did not board", ABSENT_NOTIFIED: "marked absent", UNCONFIRMED: "drop-off not confirmed",
    TRANSFERRED: "moved to another bus",
  },
  hi: {
    EXPECTED: "बस का इंतज़ार", ON_BOARD: "बस में हैं", DROPPED: "उतार दिया गया", HANDED_OVER: "सौंप दिया गया",
    MISSED: "बस में नहीं चढ़े", NO_SHOW: "बस में नहीं चढ़े", ABSENT_NOTIFIED: "अनुपस्थित", UNCONFIRMED: "पुष्टि नहीं",
    TRANSFERRED: "दूसरी बस में",
  },
  te: {
    EXPECTED: "బస్ కోసం ఎదురుచూస్తున్నారు", ON_BOARD: "బస్‌లో ఉన్నారు", DROPPED: "దించారు", HANDED_OVER: "అప్పగించారు",
    MISSED: "బస్ ఎక్కలేదు", NO_SHOW: "బస్ ఎక్కలేదు", ABSENT_NOTIFIED: "గైర్హాజరు", UNCONFIRMED: "నిర్ధారణ కాలేదు",
    TRANSFERRED: "వేరే బస్‌లో",
  },
};

export function lang(l: unknown): Lang {
  return l === "hi" || l === "te" ? l : "en";
}

export function t(l: Lang, key: string, p: P = {}): string {
  const fn = T[l][key] ?? T.en[key];
  return fn ? fn(p) : key;
}

export function stateText(l: Lang, state: string): string {
  return STATE_TEXT[l][state] ?? STATE_TEXT.en[state] ?? state;
}

export function trackUrl(payload: Record<string, unknown>): string | null {
  const token = payload.track_token as string | undefined;
  if (!token) return null;
  const base = ((payload.track_base_url as string) || Deno.env.get("TRACK_BASE_URL") || "").replace(/\/$/, "");
  return base ? `${base}/t/${token}` : null;
}

export function portalUrl(payload: Record<string, unknown>): string | null {
  const token = payload.portal_token as string | undefined;
  if (!token) return null;
  const base = ((payload.track_base_url as string) || Deno.env.get("TRACK_BASE_URL") || "").replace(/\/$/, "");
  return base ? `${base}/p/${token}` : null;
}

export function asStrings(payload: Record<string, unknown>): P {
  const out: P = {};
  for (const [k, v] of Object.entries(payload)) out[k] = v == null ? "" : String(v);
  return out;
}

/** Full plain-text message for an outbox row. */
export function renderText(row: OutboxRow): string {
  const l = lang(row.language);
  const p = asStrings(row.payload);
  if (row.event_type === "SOS") {
    p.map = p.lat && p.lng ? `https://maps.google.com/?q=${p.lat},${p.lng}` : "unknown";
  }
  let text = t(l, row.event_type, p);
  const url = row.recipient_type === "guardian" ? trackUrl(row.payload) : null;
  const withLink = ["BOARDED", "BOARDED_RETURN", "MISSED_BOARDING", "NOT_BOARDED_RETURN", "BUS_CHANGED", "INCIDENT", "KEPT_ON_BUS"];
  if (url && withLink.includes(row.event_type)) text += `\n${t(l, "TRACK", { url })}`;
  const portal = row.recipient_type === "guardian" ? portalUrl(row.payload) : null;
  if (portal && ["WELCOME", "DROPPED"].includes(row.event_type)) text += `\n${t(l, "PORTAL", { url: portal })}`;
  return text;
}

export function pushTitle(row: OutboxRow): string {
  const school = String(row.payload.school ?? "UnWay");
  const critical = ["ESCALATION", "MISSED_BOARDING", "NOT_BOARDED_RETURN", "KEPT_ON_BUS", "INCIDENT", "SOS", "DROP_UNCONFIRMED"];
  return critical.includes(row.event_type) ? `⚠️ ${school}` : school;
}
