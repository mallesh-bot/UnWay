export type Lang = "en" | "hi" | "te";

const S = {
  en: {
    turnOn: "Turn on", notReady: "Not available yet", 
    hello: "Hello {name}", welcome: "You're all set. This page shows {kids}'s school bus, every day.",
    today: "Today", morningShort: "Morning", afternoonShort: "Afternoon", startsAround: "Bus starts around {t}",
    trackLive: "Track the bus live", busDetails: "Bus details", pickup: "Morning pickup", dropHome: "Drop home", around: "around {t}",
    noRoute: "No bus route assigned yet. Please contact the school.",
    absTitle: "Not taking the bus?", absSub: "Tell the bus team in advance so nobody waits at the stop.",
    absToday: "Today", absTomorrow: "Tomorrow", pickDate: "Other date", legBOTH: "Whole day", legAM: "Morning only", legPM: "Afternoon only",
    markAbsent: "Mark not travelling", planned: "Planned", cancel: "Cancel", saved: "Saved", absentOn: "Not travelling: {d}",
    history: "Last 30 days", rides: "Trips completed", missedN: "Missed", absentN: "Absent", noHistory: "No trips in the last 30 days.",
    alerts: "Notifications", alertsSub: "How you get bus updates on your phone", connected: "On", pausedLbl: "Paused",
    noChannel: "You're not getting bus updates yet. Turn on at least one option below.",
    tgShort: "Telegram", pushShort: "Browser alerts", waShort: "WhatsApp", emailShort: "Email",
    homeTip: "Tip: add this page to your home screen so it opens like an app.", openDashboard: "Open my parent page",
    showMore: "Show all", networkErr: "Network problem. Retrying…",
    loading: "Loading…", expired: "This link has expired", expiredSub: "Tracking links work for one day. Send STATUS to the school bot for a fresh link.",
    morning: "Morning trip", afternoon: "Trip home", noTrip: "No bus trip today", bus: "Bus",
    EXPECTED: "Waiting for the bus", ON_BOARD: "On the bus", DROPPED: "Dropped off", HANDED_OVER: "Handed over to guardian",
    MISSED: "Did not board", NO_SHOW: "Did not board", ABSENT_NOTIFIED: "Marked absent", UNCONFIRMED: "Being checked by school",
    TRANSFERRED: "Moved to another bus",
    reachedSchool: "Reached school", boarded: "Boarded", droppedAt: "Dropped",
    eta: "Bus is about {m} min from {to}", updated: "Location updated {s}", stale: "Bus location is not updating. The phone may be out of network.",
    callSchool: "Call school", live: "Live", finished: "Trip finished", notStarted: "Trip not started yet",
    joinTitle: "Get bus updates for {kids}", joinSub: "{school} sends a message when your child boards and gets off the bus. It's free.",
    tg: "Connect Telegram", tgSub: "Recommended. Works on any phone. Opens the school's UnWay bot.",
    push: "Turn on alerts in this browser", pushSub: "Get notifications on this phone without any app.",
    pushOn: "Alerts are on for this browser", pushUnsupported: "This browser can't show alerts. On iPhone, add this page to the Home Screen first, or use Telegram.",
    pushDenied: "Notifications are blocked. Allow them in browser settings, or use Telegram.",
    badCode: "This invite link isn't valid", badCodeSub: "Ask the school office for a new invite.",
    already: "Already connected", privacy: "Only you and the school can see your child's trips. Location is shared only while the bus is running.",
    secAgo: "{n} s ago", minAgo: "{n} min ago",
  },
  hi: {
    turnOn: "चालू करें", notReady: "अभी उपलब्ध नहीं", 
    hello: "नमस्ते {name}", welcome: "सब तैयार है। यह पेज हर दिन {kids} की स्कूल बस की जानकारी दिखाता है।",
    today: "आज", morningShort: "सुबह", afternoonShort: "दोपहर", startsAround: "बस लगभग {t} बजे चलेगी",
    trackLive: "बस को लाइव देखें", busDetails: "बस की जानकारी", pickup: "सुबह पिकअप", dropHome: "घर छोड़ना", around: "लगभग {t}",
    noRoute: "अभी कोई बस रूट तय नहीं है। कृपया स्कूल से संपर्क करें।",
    absTitle: "बस से नहीं जा रहे?", absSub: "बस टीम को पहले बताएँ ताकि कोई स्टॉप पर इंतज़ार न करे।",
    absToday: "आज", absTomorrow: "कल", pickDate: "दूसरी तारीख", legBOTH: "पूरा दिन", legAM: "केवल सुबह", legPM: "केवल दोपहर",
    markAbsent: "नहीं जाएँगे, दर्ज करें", planned: "तय छुट्टियाँ", cancel: "रद्द करें", saved: "सेव हो गया", absentOn: "नहीं जाएँगे: {d}",
    history: "पिछले 30 दिन", rides: "पूरी यात्राएँ", missedN: "छूटी", absentN: "अनुपस्थित", noHistory: "पिछले 30 दिनों में कोई यात्रा नहीं।",
    alerts: "सूचनाएँ", alertsSub: "फ़ोन पर बस अपडेट कैसे मिलें", connected: "चालू", pausedLbl: "रुका हुआ",
    noChannel: "आपको अभी बस अपडेट नहीं मिल रहे। नीचे से कम से कम एक विकल्प चालू करें।",
    tgShort: "Telegram", pushShort: "ब्राउज़र अलर्ट", waShort: "WhatsApp", emailShort: "ईमेल",
    homeTip: "सुझाव: इस पेज को होम स्क्रीन पर जोड़ें ताकि यह ऐप की तरह खुले।", openDashboard: "मेरा अभिभावक पेज खोलें",
    showMore: "सब देखें", networkErr: "नेटवर्क समस्या। फिर से कोशिश…",
    loading: "लोड हो रहा है…", expired: "यह लिंक समाप्त हो गया है", expiredSub: "ट्रैकिंग लिंक एक दिन चलता है। नया लिंक पाने के लिए स्कूल बॉट को STATUS भेजें।",
    morning: "सुबह की यात्रा", afternoon: "घर की यात्रा", noTrip: "आज कोई बस यात्रा नहीं", bus: "बस",
    EXPECTED: "बस का इंतज़ार", ON_BOARD: "बस में हैं", DROPPED: "उतार दिया गया", HANDED_OVER: "अभिभावक को सौंपा गया",
    MISSED: "बस में नहीं चढ़े", NO_SHOW: "बस में नहीं चढ़े", ABSENT_NOTIFIED: "अनुपस्थित", UNCONFIRMED: "स्कूल जाँच कर रहा है",
    TRANSFERRED: "दूसरी बस में",
    reachedSchool: "स्कूल पहुँचे", boarded: "चढ़े", droppedAt: "उतरे",
    eta: "बस {to} से लगभग {m} मिनट दूर है", updated: "स्थान अपडेट: {s}", stale: "बस का स्थान अपडेट नहीं हो रहा। फ़ोन नेटवर्क से बाहर हो सकता है।",
    callSchool: "स्कूल को कॉल करें", live: "लाइव", finished: "यात्रा पूरी", notStarted: "यात्रा अभी शुरू नहीं हुई",
    joinTitle: "{kids} के लिए बस अपडेट पाएँ", joinSub: "{school} आपके बच्चे के बस में चढ़ने और उतरने पर संदेश भेजता है। यह मुफ़्त है।",
    tg: "Telegram से जुड़ें", tgSub: "सुझावित। किसी भी फ़ोन पर चलता है।",
    push: "इस ब्राउज़र में अलर्ट चालू करें", pushSub: "बिना ऐप के इस फ़ोन पर सूचना पाएँ।",
    pushOn: "इस ब्राउज़र में अलर्ट चालू हैं", pushUnsupported: "यह ब्राउज़र अलर्ट नहीं दिखा सकता। Telegram का उपयोग करें।",
    pushDenied: "सूचनाएँ बंद हैं। ब्राउज़र सेटिंग में अनुमति दें या Telegram का उपयोग करें।",
    badCode: "यह आमंत्रण लिंक मान्य नहीं है", badCodeSub: "स्कूल कार्यालय से नया लिंक माँगें।",
    already: "पहले से जुड़े हैं", privacy: "आपके बच्चे की यात्रा केवल आप और स्कूल देख सकते हैं। स्थान केवल बस चलते समय साझा होता है।",
    secAgo: "{n} सेकंड पहले", minAgo: "{n} मिनट पहले",
  },
  te: {
    turnOn: "ఆన్ చేయండి", notReady: "ఇంకా అందుబాటులో లేదు", 
    hello: "నమస్తే {name}", welcome: "అంతా సిద్ధం. ఈ పేజీ ప్రతిరోజూ {kids} స్కూల్ బస్ సమాచారం చూపిస్తుంది.",
    today: "ఈరోజు", morningShort: "ఉదయం", afternoonShort: "మధ్యాహ్నం", startsAround: "బస్ సుమారు {t}కి బయలుదేరుతుంది",
    trackLive: "బస్‌ను లైవ్‌లో చూడండి", busDetails: "బస్ వివరాలు", pickup: "ఉదయం పికప్", dropHome: "ఇంటికి డ్రాప్", around: "సుమారు {t}",
    noRoute: "ఇంకా బస్ రూట్ కేటాయించలేదు. దయచేసి స్కూల్‌ను సంప్రదించండి.",
    absTitle: "బస్‌లో రావడం లేదా?", absSub: "స్టాప్ వద్ద ఎవరూ ఎదురుచూడకుండా బస్ టీమ్‌కు ముందే తెలియజేయండి.",
    absToday: "ఈరోజు", absTomorrow: "రేపు", pickDate: "వేరే తేదీ", legBOTH: "రోజంతా", legAM: "ఉదయం మాత్రమే", legPM: "మధ్యాహ్నం మాత్రమే",
    markAbsent: "రావడం లేదని నమోదు చేయండి", planned: "ప్లాన్ చేసిన సెలవులు", cancel: "రద్దు", saved: "సేవ్ అయింది", absentOn: "రావడం లేదు: {d}",
    history: "గత 30 రోజులు", rides: "పూర్తైన ప్రయాణాలు", missedN: "మిస్", absentN: "గైర్హాజరు", noHistory: "గత 30 రోజుల్లో ప్రయాణాలు లేవు.",
    alerts: "నోటిఫికేషన్లు", alertsSub: "ఫోన్‌లో బస్ అప్‌డేట్లు ఎలా రావాలి", connected: "ఆన్", pausedLbl: "ఆపారు",
    noChannel: "మీకు ఇంకా బస్ అప్‌డేట్లు రావడం లేదు. కింద కనీసం ఒక ఆప్షన్ ఆన్ చేయండి.",
    tgShort: "Telegram", pushShort: "బ్రౌజర్ అలర్ట్‌లు", waShort: "WhatsApp", emailShort: "ఈమెయిల్",
    homeTip: "సూచన: ఈ పేజీని హోమ్ స్క్రీన్‌కు జోడించండి, యాప్‌లా తెరుచుకుంటుంది.", openDashboard: "నా పేరెంట్ పేజీ తెరవండి",
    showMore: "అన్నీ చూడండి", networkErr: "నెట్‌వర్క్ సమస్య. మళ్ళీ ప్రయత్నిస్తున్నాం…",
    loading: "లోడ్ అవుతోంది…", expired: "ఈ లింక్ గడువు ముగిసింది", expiredSub: "ట్రాకింగ్ లింక్ ఒక్క రోజు పనిచేస్తుంది. కొత్త లింక్ కోసం స్కూల్ బాట్‌కు STATUS పంపండి.",
    morning: "ఉదయం ప్రయాణం", afternoon: "ఇంటికి ప్రయాణం", noTrip: "ఈరోజు బస్ ట్రిప్ లేదు", bus: "బస్",
    EXPECTED: "బస్ కోసం ఎదురుచూస్తున్నారు", ON_BOARD: "బస్‌లో ఉన్నారు", DROPPED: "దించారు", HANDED_OVER: "తల్లిదండ్రులకు అప్పగించారు",
    MISSED: "బస్ ఎక్కలేదు", NO_SHOW: "బస్ ఎక్కలేదు", ABSENT_NOTIFIED: "గైర్హాజరు", UNCONFIRMED: "స్కూల్ తనిఖీ చేస్తోంది",
    TRANSFERRED: "వేరే బస్‌లో",
    reachedSchool: "స్కూల్ చేరారు", boarded: "ఎక్కారు", droppedAt: "దిగారు",
    eta: "బస్ {to} కి సుమారు {m} నిమిషాల దూరంలో ఉంది", updated: "లొకేషన్ అప్‌డేట్: {s}", stale: "బస్ లొకేషన్ అప్‌డేట్ కావడం లేదు. ఫోన్ నెట్‌వర్క్‌లో లేకపోవచ్చు.",
    callSchool: "స్కూల్‌కు కాల్", live: "లైవ్", finished: "ప్రయాణం పూర్తైంది", notStarted: "ప్రయాణం ఇంకా మొదలవలేదు",
    joinTitle: "{kids} కోసం బస్ అప్‌డేట్లు పొందండి", joinSub: "మీ పిల్లలు బస్ ఎక్కినప్పుడు, దిగినప్పుడు {school} సందేశం పంపుతుంది. ఇది ఉచితం.",
    tg: "Telegram కనెక్ట్ చేయండి", tgSub: "సిఫార్సు. ఏ ఫోన్‌లోనైనా పనిచేస్తుంది.",
    push: "ఈ బ్రౌజర్‌లో అలర్ట్‌లు ఆన్ చేయండి", pushSub: "యాప్ లేకుండానే ఈ ఫోన్‌లో నోటిఫికేషన్లు.",
    pushOn: "ఈ బ్రౌజర్‌లో అలర్ట్‌లు ఆన్‌లో ఉన్నాయి", pushUnsupported: "ఈ బ్రౌజర్ అలర్ట్‌లు చూపించలేదు. Telegram ఉపయోగించండి.",
    pushDenied: "నోటిఫికేషన్లు బ్లాక్ అయ్యాయి. బ్రౌజర్ సెట్టింగ్స్‌లో అనుమతించండి లేదా Telegram ఉపయోగించండి.",
    badCode: "ఈ ఆహ్వాన లింక్ చెల్లదు", badCodeSub: "స్కూల్ ఆఫీస్ నుండి కొత్త లింక్ అడగండి.",
    already: "ఇప్పటికే కనెక్ట్ అయ్యారు", privacy: "మీ పిల్లల ప్రయాణాలు మీకు, స్కూల్‌కు మాత్రమే కనిపిస్తాయి. బస్ నడుస్తున్నప్పుడు మాత్రమే లొకేషన్ షేర్ అవుతుంది.",
    secAgo: "{n} సెకన్ల క్రితం", minAgo: "{n} నిమిషాల క్రితం",
  },
} as const;

export type Key = keyof typeof S.en;

export function tr(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  let s: string = (S[lang] as Record<string, string>)[key] ?? S.en[key];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function initialLang(): Lang {
  const saved = (() => { try { return localStorage.getItem("unway-lang"); } catch { return null; } })();
  if (saved === "en" || saved === "hi" || saved === "te") return saved;
  const n = navigator.language.slice(0, 2);
  return n === "hi" || n === "te" ? n : "en";
}
export function saveLang(l: Lang) { try { localStorage.setItem("unway-lang", l); } catch { /* ignore */ } }
