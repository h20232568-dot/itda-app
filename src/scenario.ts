// 잇다 이동 세션: 화면이 아니라 "지금 상태"를 한 곳에서 관리한다.
// 실시간 버스·GPS 연동 전까지는 버스 위치와 정류장 진행을 시뮬레이션한다.
// 노선 출처: bustrain.kr(국토교통부 공공데이터 API, 2026-11-21 갱신) 춘천 3번 버스.
// 노선 개편 여부는 카카오맵 등에서 다시 확인할 것.

export const ROUTE = {
  bus: "3",
  origin: "후평동종점",
  destination: "명동입구",
  place: "명동",
};

/** 3번 버스: 후평동종점 → 명동입구(하차) → 중앙시장/중앙초교(하차 놓침 시) */
export const STOPS = [
  "후평동종점",
  "춘천기계공고",
  "정부합동청사",
  "강원도시가스",
  "신성교회",
  "토우시장",
  "포스코후문",
  "크로바A",
  "봉의중학교",
  "교동초교입구",
  "동부시장",
  "육림고개",
  "시청입구",
  "명동입구",
  "중앙시장/중앙초교",
];

export const DEST = 13; // 명동입구
export const LANDMARK = 10; // 동부시장
export const NEXT_AFTER_DEST = 14; // 중앙시장/중앙초교
export const FIRST_ALERT = 2; // 두 정거장 전
export const BUS_START_AWAY = 5; // 안내 시작 시 버스 위치(정거장 수)
export const NEXT_BUS_AWAY = 7; // 버스를 놓쳤을 때 다음 차 위치

export type Scene =
  | "home"
  | "listening"
  | "confirm"
  | "wait"
  | "arriving"
  | "boardCheck"
  | "missedBus"
  | "ride"
  | "alightCheck"
  | "missedStop"
  | "altAlightCheck"
  | "returnGuide"
  | "done";

export type Sim = {
  scene: Scene;
  /** 버스가 정류장에서 몇 정거장 떨어져 있는지 (대기 중) */
  busAway: number;
  /** 버스가 마지막으로 지난(떠난) 정류장 번호 */
  passed: number;
  /** 위치를 확신할 수 없는 상태 */
  uncertain: boolean;
  /** 위치가 불확실해진 정류장 번호 (두 정거장 뒤 다시 확인됨) */
  uncertainFrom?: number;
  /** 홈 화면 안내 문구(되묻기 등) */
  homeNote?: string;
  /** 인식된 사용자 발화 */
  heard?: string;
};

export type VibeKey = "tap" | "double" | "shortShort" | "long";

export const VIBES: Record<VibeKey, { label: string; pattern: number[] }> = {
  tap: { label: "짧게", pattern: [150] },
  double: { label: "짧게 두 번", pattern: [150, 120, 150] },
  shortShort: { label: "짧게-짧게", pattern: [200, 120, 200, 120, 200] },
  long: { label: "길게", pattern: [900] },
};

export type Cue = {
  say: string;
  vibe?: VibeKey;
};

export const initialSim: Sim = {
  scene: "home",
  busAway: BUS_START_AWAY,
  passed: 0,
  uncertain: false,
};

export const JOURNEY_SCENES: Scene[] = [
  "wait",
  "arriving",
  "boardCheck",
  "missedBus",
  "ride",
  "alightCheck",
  "missedStop",
  "altAlightCheck",
  "returnGuide",
];

export const POCKET_SCENES: Scene[] = ["ride", "alightCheck", "missedStop", "altAlightCheck"];

// ── 한국어 도우미 ───────────────────────────────────────────

const NATIVE = ["영", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열", "열한", "열두", "열세", "열네", "열다섯"];

/** 3 → "세" (정거장 수를 말로 읽을 때) */
export function kor(n: number) {
  return NATIVE[n] ?? String(n);
}

function hasFinalConsonant(word: string) {
  const ch = word.charCodeAt(word.length - 1);
  if (ch < 0xac00 || ch > 0xd7a3) return false;
  return (ch - 0xac00) % 28 !== 0;
}

/** 을/를 */
export function eul(word: string) {
  return word + (hasFinalConsonant(word) ? "을" : "를");
}

export function stopName(i: number) {
  return STOPS[i]?.split("/")[0] ?? "";
}

export const remaining = (s: Sim) => DEST - s.passed;
export const etaMinutes = (busAway: number) => Math.max(1, busAway * 2);

// ── 상태별 안내 ─────────────────────────────────────────────

export function isAlert(s: Sim) {
  return s.scene === "ride" && !s.uncertain && remaining(s) <= FIRST_ALERT && remaining(s) >= 1;
}

/** 상태가 바뀔 때 AI가 먼저 하는 말 */
export function cueFor(next: Sim, prev: Sim, opts: { guardian?: boolean } = {}): Cue {
  const r = remaining(next);

  switch (next.scene) {
    case "home":
      if (next.homeNote) return { say: next.homeNote };
      return {
        say: "어디로 가실 건가요? 가운데 버튼을 누르고 말씀해 주세요.",
      };
    case "listening":
      return { say: "" };
    case "confirm":
      return {
        say: `자주 가시는 ${ROUTE.place} 맞으세요? ${ROUTE.origin}에서 ${ROUTE.bus}번 버스를 타고 ${ROUTE.destination}에서 내리시면 돼요.`,
      };
    case "wait":
      if (prev.scene === "confirm" || prev.scene === "home") {
        return {
          say: `안내를 시작할게요. ${ROUTE.origin} 정류장에서 ${ROUTE.bus}번 버스를 기다려 주세요. 버스가 가까워지면 먼저 알려 드릴게요.`,
          vibe: "tap",
        };
      }
      if (prev.scene === "missedBus") {
        return { say: "" };
      }
      if (next.busAway === 3) {
        return {
          say: `기다리시는 ${ROUTE.bus}번 버스가 세 정거장 뒤에 와요. 약 ${etaMinutes(3)}분 남았어요.`,
          vibe: "tap",
        };
      }
      if (next.busAway === 1) {
        return {
          say: `${ROUTE.bus}번 버스가 한 정거장 뒤에 있어요. 곧 와요.`,
        };
      }
      return { say: "" };
    case "arriving":
      return {
        say: `${ROUTE.bus}번 버스가 곧 도착해요. 교통카드를 준비하시고, 버스 앞 번호 ${ROUTE.bus}번을 확인해 주세요.`,
        vibe: "double",
      };
    case "boardCheck":
      return {
        say: `${ROUTE.bus}번 버스 타셨나요?`,
      };
    case "missedBus":
      return {
        say: `괜찮아요. 다음 ${ROUTE.bus}번 버스는 ${kor(NEXT_BUS_AWAY)} 정거장 뒤에 있어요. 약 ${etaMinutes(NEXT_BUS_AWAY)}분 뒤에 와요. 가까워지면 다시 알려 드릴게요.`,
        vibe: "tap",
      };
    case "ride": {
      if (prev.scene !== "ride") {
        return {
          say: `잘 타셨어요. ${ROUTE.destination}까지 ${kor(r)} 정거장 남았어요. 휴대폰은 주머니에 넣으셔도 돼요. 내릴 때가 되면 먼저 알려 드릴게요.`,
        };
      }
      if (next.uncertain && !prev.uncertain) {
        return {
          say: "지금 위치를 정확히 알 수 없어요. 버스 안내 방송에서 정류장 이름을 확인해 주세요.",
          vibe: "tap",
        };
      }
      if (!next.uncertain && prev.uncertain) {
        if (r === 2) {
          return { say: "위치를 다시 확인했어요. 두 정거장 뒤에 내려요. 소지품을 챙겨 주세요.", vibe: "shortShort" };
        }
        if (r === 1) {
          return { say: "위치를 다시 확인했어요. 다음 정류장이에요. 손잡이를 잡고 안내 방송을 확인해 주세요.", vibe: "long" };
        }
        return { say: `위치를 다시 확인했어요. ${ROUTE.destination}까지 ${kor(r)} 정거장 남았어요.` };
      }
      if (next.uncertain) {
        return { say: "" };
      }
      if (r === 2) {
        return {
          say: `두 정거장 뒤에 내려요. 소지품을 챙겨 주세요. 다음은 ${stopName(DEST - 1)}예요.`,
          vibe: "shortShort",
        };
      }
      if (r === 1) {
        return {
          say: "다음 정류장이에요. 손잡이를 잡고 안내 방송을 확인해 주세요.",
          vibe: "long",
        };
      }
      if (next.passed === LANDMARK) {
        return {
          say: `지금 ${eul(stopName(LANDMARK))} 지나고 있어요. ${ROUTE.destination}까지 ${kor(r)} 정거장 남았어요.`,
        };
      }
      return { say: "" };
    }
    case "alightCheck":
      if (next.uncertain) {
        return {
          say: `버스가 정류장에 섰어요. 안내 방송에서 ${ROUTE.destination}라고 나오면 내려 주세요. 내리셨나요?`,
          vibe: "tap",
        };
      }
      return {
        say: `${ROUTE.destination} 정류장이에요. 내리셨나요?`,
        vibe: "tap",
      };
    case "missedStop":
      return {
        say: `괜찮아요. 급하게 내리지 마세요. 다음 정류장인 ${stopName(NEXT_AFTER_DEST)}에서 내리시면 돌아가는 길을 알려 드릴게요.`,
        vibe: "double",
      };
    case "altAlightCheck":
      return {
        say: `${stopName(NEXT_AFTER_DEST)} 정류장이에요. 손잡이를 잡고 천천히 내려 주세요. 내리셨나요?`,
        vibe: "long",
      };
    case "returnGuide":
      return {
        say: `잘 내리셨어요. ${ROUTE.destination}는 버스가 지나온 쪽으로 한 정거장 거리예요. 길이 헷갈리시면 주변 분께 명동 방향을 여쭤보셔도 좋아요.`,
      };
    case "done":
      return {
        say: opts.guardian
          ? `${ROUTE.place}에 잘 도착하셨어요. 보호자께도 도착 문자를 보냈어요. 안내를 마칠게요.`
          : `${ROUTE.place}에 잘 도착하셨어요. 안내를 마칠게요.`,
        vibe: "tap",
      };
  }
}

/** 다음 상태 (버스 진행 또는 사용자의 "예" 답) */
export function nextOf(s: Sim): Sim | null {
  switch (s.scene) {
    case "home":
      return { ...s, scene: "listening", homeNote: undefined, heard: undefined };
    case "listening":
      return null;
    case "confirm":
      return { ...s, scene: "wait", busAway: BUS_START_AWAY, passed: 0, uncertain: false, heard: undefined };
    case "wait":
      return s.busAway > 1 ? { ...s, busAway: s.busAway - 1 } : { ...s, scene: "arriving", busAway: 0 };
    case "arriving":
      return { ...s, scene: "boardCheck" };
    case "boardCheck":
      return { ...s, scene: "ride", passed: 0, uncertain: false };
    case "missedBus":
      return { ...s, scene: "wait", busAway: NEXT_BUS_AWAY - 1 };
    case "ride": {
      const passed = s.passed + 1;
      const recovered = s.uncertain && s.uncertainFrom !== undefined && passed - s.uncertainFrom >= 2;
      const base = recovered ? { ...s, uncertain: false, uncertainFrom: undefined } : s;
      return passed >= DEST ? { ...base, scene: "alightCheck", passed: DEST } : { ...base, passed };
    }
    case "alightCheck":
      return { ...s, scene: "done", uncertain: false };
    case "missedStop":
      return { ...s, scene: "altAlightCheck", passed: NEXT_AFTER_DEST, uncertain: false };
    case "altAlightCheck":
      return { ...s, scene: "returnGuide" };
    case "returnGuide":
      return { ...s, scene: "done" };
    case "done":
      return null;
  }
}

/** 자동 진행해도 되는 상태 (사용자 확인이 필요한 곳은 멈춘다) */
export function autoAdvances(s: Sim) {
  return ["wait", "arriving", "missedBus", "ride", "missedStop", "returnGuide"].includes(s.scene);
}

/** 말이 끝난 뒤 다음 상태로 넘어가기까지의 쉬는 시간(ms) */
export function autoGap(s: Sim) {
  if (s.scene === "ride" && !s.uncertain) {
    const r = remaining(s);
    if (r <= 2) return 4500;
    if (s.passed === LANDMARK) return 3000;
    if (s.passed === 0) return 2500;
    return 1300;
  }
  if (s.scene === "ride" && s.uncertain) return 2500;
  if (s.scene === "wait") return 2200;
  return 3000;
}

/** "다시 알려줘": 직전 말을 다시 트는 게 아니라 지금 상태로 새로 만든다 */
export function describeNow(s: Sim): string {
  const r = remaining(s);
  switch (s.scene) {
    case "wait":
      return `${ROUTE.bus}번 버스가 ${kor(s.busAway)} 정거장 뒤에 있어요. 약 ${etaMinutes(s.busAway)}분 뒤에 와요. 정류장에서 기다려 주세요.`;
    case "arriving":
      return `${ROUTE.bus}번 버스가 곧 도착해요. 버스 앞 번호 ${ROUTE.bus}번을 확인하고 타 주세요.`;
    case "ride":
      if (s.uncertain) return "지금 위치를 확인하고 있어요. 버스 안내 방송에서 정류장 이름을 들어 주세요.";
      if (r === 2) return `두 정거장 뒤 ${ROUTE.destination}에서 내려요. 다음은 ${stopName(DEST - 1)}예요. 소지품을 챙겨 주세요.`;
      if (r === 1) return `다음 정류장 ${ROUTE.destination}에서 내려요. 손잡이를 잡고 안내 방송을 확인해 주세요.`;
      return `지금 ${eul(stopName(s.passed))} 지났어요. ${ROUTE.destination}까지 ${kor(r)} 정거장 남았어요. 내릴 때가 되면 먼저 알려 드릴게요.`;
    default:
      return cueFor(s, s).say || "지금은 새로 알려 드릴 내용이 없어요.";
  }
}

/** "얼마나 남았어?" */
export function howLong(s: Sim): string {
  const r = remaining(s);
  if (s.scene === "wait") return `${ROUTE.bus}번 버스는 약 ${etaMinutes(s.busAway)}분 뒤에 와요.`;
  if (s.scene === "arriving") return `${ROUTE.bus}번 버스가 곧 도착해요.`;
  if (s.scene === "ride") {
    if (s.uncertain) return "지금은 위치가 정확하지 않아 남은 시간을 말씀드리기 어려워요. 안내 방송을 확인해 주세요.";
    return `${ROUTE.destination}까지 ${kor(r)} 정거장, 약 ${r * 2}분 남았어요.`;
  }
  return "아직 버스를 타기 전이에요.";
}

/** 홈 화면 직접 입력 해석 */
export function interpretDestination(text: string): { ok: true } | { ok: false; note: string } {
  const t = text.replace(/\s/g, "");
  if (!t) return { ok: false, note: "가고 싶은 곳을 말씀하거나 입력해 주세요." };
  if (/명동/.test(t)) return { ok: true };
  if (/성심병원/.test(t)) return { ok: false, note: ROUTE_UNAVAILABLE("춘천성심병원") };
  if (/병원/.test(t)) return { ok: false, note: "어느 병원인지 확실하지 않아요. 병원 이름을 말씀해 주세요." };
  return { ok: false, note: `“${text.trim()}”${hasFinalConsonant(text.trim()) ? "을" : "를"} 찾지 못했어요. 장소 이름을 다시 말씀해 주세요.` };
}

/** 노선 정보를 불러올 수 없는 목적지 */
export function ROUTE_UNAVAILABLE(place: string) {
  return `${place}까지 가는 버스 정보를 지금 불러오지 못했어요. 잠시 후 다시 시도해 주세요.`;
}

export const SCENE_LABEL: Record<Scene, string> = {
  home: "목적지 설정",
  listening: "듣는 중",
  confirm: "목적지 확인",
  wait: "정류장 대기",
  arriving: "버스 도착",
  boardCheck: "탑승 확인",
  missedBus: "버스 놓침",
  ride: "버스 이동",
  alightCheck: "하차 확인",
  missedStop: "하차 놓침",
  altAlightCheck: "다음 정류장 하차",
  returnGuide: "돌아가는 길",
  done: "안내 종료",
};

/** "지금 어디야?" */
export function whereNow(s: Sim): string {
  const r = remaining(s);
  switch (s.scene) {
    case "home":
    case "listening":
    case "confirm":
      return "아직 길 안내를 시작하지 않았어요. 가고 싶은 곳을 말씀해 주시면 알려 드릴게요.";
    case "wait":
    case "arriving":
    case "missedBus":
    case "boardCheck":
      return `${ROUTE.origin} 정류장에 계세요. ${ROUTE.bus}번 버스를 기다리는 중이에요.`;
    case "ride":
      if (s.uncertain) return "지금은 위치를 정확히 알 수 없어요. 버스 안내 방송에서 정류장 이름을 확인해 주세요.";
      return `${ROUTE.bus}번 버스 안이에요. 방금 ${eul(stopName(s.passed))} 지났고, ${ROUTE.destination}까지 ${kor(r)} 정거장 남았어요.`;
    case "alightCheck":
      return `${ROUTE.destination} 정류장이에요.`;
    case "missedStop":
      return `${ROUTE.destination}를 지나 ${stopName(NEXT_AFTER_DEST)} 정류장으로 가고 있어요.`;
    case "altAlightCheck":
      return `${stopName(NEXT_AFTER_DEST)} 정류장이에요.`;
    case "returnGuide":
      return `${stopName(NEXT_AFTER_DEST)} 정류장 근처예요. ${ROUTE.destination}는 한 정거장 거리예요.`;
    case "done":
      return `${ROUTE.place}에 도착하셨어요.`;
  }
}
