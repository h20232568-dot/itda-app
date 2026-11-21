// 음성(speechSynthesis)과 진동(Vibration API).
// 음성을 지원하지 않거나 꺼 둔 경우에도 안내가 이어지도록, 읽는 시간만큼 "말하는 중" 상태를 유지한다.

export const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window;
export const vibrationSupported = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

let koreanVoice: SpeechSynthesisVoice | null = null;
let voiceEnabled = true;
let currentToken = 0;

function pickVoice() {
  if (!speechSupported) return;
  const voices = window.speechSynthesis.getVoices();
  koreanVoice = voices.find((v) => v.lang === "ko-KR") ?? voices.find((v) => v.lang.toLowerCase().startsWith("ko")) ?? null;
}

if (speechSupported) {
  pickVoice();
  window.speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

export function hasKoreanVoice() {
  if (!koreanVoice) pickVoice();
  return koreanVoice !== null;
}

let speechRate = 0.92;

/** 말하기 속도: 천천히 0.8, 보통 0.92 */
export function setSpeechRate(rate: number) {
  speechRate = rate;
}

export function setVoiceEnabled(on: boolean) {
  voiceEnabled = on;
  if (!on && speechSupported) window.speechSynthesis.cancel();
}

/** 첫 터치에서 호출: 안드로이드·iOS는 사용자가 한 번 눌러야 소리를 낼 수 있다 */
export function unlockAudio() {
  if (speechSupported) {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }
  if (vibrationSupported) navigator.vibrate(1);
}

/** 한국어 한 글자당 대략 0.17초 */
function estimateMs(text: string) {
  return Math.min(14000, 900 + text.length * 170);
}

export function stopSpeaking() {
  currentToken++;
  if (speechSupported) window.speechSynthesis.cancel();
}

export function speak(text: string, onStart: () => void, onEnd: () => void) {
  const token = ++currentToken;
  let finished = false;
  const finish = () => {
    if (finished || token !== currentToken) return;
    finished = true;
    onEnd();
  };

  if (!text) {
    onEnd();
    return;
  }

  onStart();
  const fallbackMs = estimateMs(text);

  if (!voiceEnabled || !speechSupported || !hasKoreanVoice()) {
    window.setTimeout(finish, fallbackMs);
    return;
  }

  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  if (koreanVoice) u.voice = koreanVoice;
  u.rate = speechRate;
  u.onend = finish;
  u.onerror = finish;
  synth.speak(u);
  // onend가 오지 않는 브라우저 대비
  window.setTimeout(finish, fallbackMs * 1.6 + 2000);
}

// ── 음성 인식 (Web Speech API) ──

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

const RecognitionCtor: (new () => RecognitionLike) | undefined =
  typeof window !== "undefined"
    ? ((window as unknown as { SpeechRecognition?: new () => RecognitionLike }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => RecognitionLike }).webkitSpeechRecognition)
    : undefined;

export const recognitionSupported = Boolean(RecognitionCtor);

export type ListenError = "unsupported" | "denied" | "no-speech" | "failed";

/** 한 번 듣고 끝난다. 반환값을 호출하면 듣기를 멈춘다. */
export function listenOnce(onResult: (text: string) => void, onFail: (reason: ListenError) => void): () => void {
  if (!RecognitionCtor) {
    onFail("unsupported");
    return () => {};
  }
  stopSpeaking();
  const rec = new RecognitionCtor();
  rec.lang = "ko-KR";
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  let settled = false;
  rec.onresult = (e) => {
    const text = e.results[e.results.length - 1]?.[0]?.transcript?.trim() ?? "";
    settled = true;
    if (text) onResult(text);
    else onFail("no-speech");
  };
  rec.onerror = (e) => {
    if (settled) return;
    settled = true;
    onFail(e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied" : e.error === "no-speech" ? "no-speech" : "failed");
  };
  rec.onend = () => {
    if (settled) return;
    settled = true;
    onFail("no-speech");
  };
  try {
    rec.start();
  } catch {
    settled = true;
    onFail("failed");
  }
  return () => {
    if (!settled) {
      settled = true;
      rec.abort();
      onFail("no-speech");
    }
  };
}

export function vibrate(pattern: number[]) {
  // 사용자가 한 번도 누르지 않았으면 브라우저가 진동을 막으므로 시도하지 않는다
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return;
  if (vibrationSupported) navigator.vibrate(pattern);
}
