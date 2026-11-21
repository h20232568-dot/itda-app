import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, type IconName } from "./icons";
import {
  DEST,
  JOURNEY_SCENES,
  LANDMARK,
  NEXT_AFTER_DEST,
  POCKET_SCENES,
  ROUTE,
  ROUTE_UNAVAILABLE,
  SCENE_LABEL,
  VIBES,
  autoAdvances,
  autoGap,
  cueFor,
  describeNow,
  etaMinutes,
  howLong,
  initialSim,
  interpretDestination,
  isAlert,
  kor,
  nextOf,
  remaining,
  stopName,
  whereNow,
  type Sim,
} from "./scenario";
import { GUARDIAN, SettingsScreen, loadSettings, saveSettings, type AppSettings, type Trip } from "./Settings";
import { listenOnce, setSpeechRate, setVoiceEnabled, speak, stopSpeaking, unlockAudio, vibrate, type ListenError } from "./feedback";

type Tab = "home" | "guide" | "help" | "settings";
type VibeFlash = { id: number; label: string };

const LISTEN_FAIL: Record<ListenError, string> = {
  unsupported: "이 기기에서는 음성 인식을 쓸 수 없어요. 아래 입력창에 목적지를 적어 주세요.",
  denied: "마이크 권한이 꺼져 있어요. 휴대폰 설정에서 마이크를 허용하시거나 아래 입력창을 이용해 주세요.",
  "no-speech": "말씀을 듣지 못했어요. 버튼을 다시 누르고 말씀해 주세요.",
  failed: "음성 인식이 잠시 안 돼요. 다시 누르시거나 직접 입력해 주세요.",
};

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "home", label: "홈", icon: "home" },
  { id: "guide", label: "이동 동행", icon: "route" },
  { id: "help", label: "AI 도움", icon: "help" },
  { id: "settings", label: "설정", icon: "gear" },
];

function Wave({ active, light = false }: { active: boolean; light?: boolean }) {
  return (
    <span className={`wave ${active ? "is-active" : ""} ${light ? "is-light" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function TripLine({ trip }: { trip: Trip }) {
  return (
    <div className="trip-line">
      <span className="trip-node" />
      <strong>{trip.from}</strong>
      <span className="route-chip is-small">{trip.bus}</span>
      <strong>{trip.to}</strong>
      <span className="trip-node is-end" />
    </div>
  );
}

export default function App() {
  const [sim, setSim] = useState<Sim>(initialSim);
  const [tab, setTab] = useState<Tab>("home");
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [arrivedAt, setArrivedAt] = useState("");
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState("");
  const [userSaid, setUserSaid] = useState("");
  const [helpAnswer, setHelpAnswer] = useState("");
  const [vibe, setVibe] = useState<VibeFlash | null>(null);
  const [endConfirm, setEndConfirm] = useState(false);
  const [askSheet, setAskSheet] = useState(false);
  const [typed, setTyped] = useState("");
  const prevSim = useRef<Sim>(sim);
  const stopListening = useRef<(() => void) | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);

  // 메뉴를 바꾸거나 AI가 답하면 화면 맨 위로
  useEffect(() => {
    screenRef.current?.scrollTo({ top: 0 });
  }, [tab, helpAnswer]);

  const inJourney = JOURNEY_SCENES.includes(sim.scene);
  const guideActive = inJourney || sim.scene === "done";
  const onGuide = tab === "guide" && guideActive;
  const pocket = onGuide && POCKET_SCENES.includes(sim.scene);
  const alert = onGuide && isAlert(sim);
  const navHidden = pocket || alert;
  const r = remaining(sim);

  // ── 음성·진동 ──
  const say = useCallback((text: string) => {
    if (!text) return;
    setCaption(text);
    speak(
      text,
      () => setSpeaking(true),
      () => setSpeaking(false),
    );
  }, []);

  // 안드로이드는 사용자가 한 번 눌러야 소리·진동을 낼 수 있다
  useEffect(() => {
    const once = () => {
      unlockAudio();
      window.removeEventListener("pointerdown", once);
    };
    window.addEventListener("pointerdown", once);
    return () => window.removeEventListener("pointerdown", once);
  }, []);

  useEffect(() => () => stopListening.current?.(), []);

  useEffect(() => {
    saveSettings(settings);
    setVoiceEnabled(settings.voice);
    setSpeechRate(settings.rate === "slow" ? 0.8 : 0.92);
  }, [settings]);

  const flashVibe = useCallback((key: keyof typeof VIBES) => {
    if (!settingsRef.current.vibration) return;
    vibrate(VIBES[key].pattern);
    const id = Date.now();
    setVibe({ id, label: VIBES[key].label });
    window.setTimeout(() => setVibe((v) => (v?.id === id ? null : v)), 2400);
  }, []);

  // 상태가 바뀌면 AI가 먼저 말한다
  useEffect(() => {
    const prev = prevSim.current;
    if (prev === sim) return;
    prevSim.current = sim;
    const cue = cueFor(sim, prev, { guardian: settingsRef.current.guardian });
    if (sim.scene === "done" && prev.scene !== "done") {
      const now = new Date();
      const h = now.getHours();
      setArrivedAt(`${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")}`);
      const trip: Trip = { id: `t${now.getTime()}`, from: ROUTE.origin, to: ROUTE.destination, bus: ROUTE.bus, when: "오늘" };
      setSettings((s) => ({ ...s, recents: [trip, ...s.recents].slice(0, 10) }));
    }
    if (cue.vibe) flashVibe(cue.vibe);
    if (cue.say) say(cue.say);
  }, [sim, say, flashVibe]);

  const go = useCallback((next: Sim | null) => {
    if (!next) return;
    setUserSaid("");
    setAskSheet(false);
    setSim(next);
  }, []);

  // 버스 위치·정류장 진행: 안내 말이 끝나면 잠시 뒤 다음 상태로
  useEffect(() => {
    if (speaking || endConfirm || !autoAdvances(sim)) return;
    const t = window.setTimeout(() => go(nextOf(sim)), autoGap(sim));
    return () => window.clearTimeout(t);
  }, [speaking, endConfirm, sim, go]);

  // ── 목적지 ──
  const reply = (text: string, next: Sim | null) => {
    go(next);
    setUserSaid(text);
  };

  const handleDestination = (text: string) => {
    const result = interpretDestination(text);
    if (result.ok) {
      setSim((s) => ({ ...s, scene: "confirm", homeNote: undefined, heard: text }));
      setUserSaid(text);
    } else {
      setSim((s) => ({ ...s, scene: "home", homeNote: result.note }));
    }
  };

  const startListening = () => {
    if (inJourney) return;
    setTab("home");
    if (sim.scene === "listening") {
      stopListening.current?.();
      return;
    }
    go({ ...sim, scene: "listening", homeNote: undefined });
    stopListening.current = listenOnce(
      (text) => {
        stopListening.current = null;
        setTyped(text);
        handleDestination(text);
      },
      (reason) => {
        stopListening.current = null;
        setSim((s) => ({ ...s, scene: "home", homeNote: LISTEN_FAIL[reason] }));
      },
    );
  };

  const submitTyped = (e: FormEvent) => {
    e.preventDefault();
    handleDestination(typed);
  };

  const chooseRoute = () => {
    setTab("home");
    go({ ...initialSim, scene: "confirm" });
  };

  const startJourney = () => {
    reply("응, 맞아", nextOf(sim));
    setTab("guide");
  };

  const resetToHome = (note?: string) => {
    stopSpeaking();
    setSpeaking(false);
    setEndConfirm(false);
    setTyped("");
    setCaption("");
    setHelpAnswer("");
    setTab("home");
    go({ ...initialSim, homeNote: note });
  };

  // ── AI에게 묻기 ──
  const ask = (question: string, answer: string) => {
    setUserSaid(question);
    setHelpAnswer(answer);
    setAskSheet(false);
    say(answer);
  };

  const askArrivalAlert = () =>
    ask(
      "도착 전에 알려줘",
      inJourney
        ? `네, ${ROUTE.destination} 두 정거장 전과 한 정거장 전에 진동과 소리로 먼저 알려 드릴게요.`
        : "길 안내를 시작하면 내리기 두 정거장 전과 한 정거장 전에 먼저 알려 드릴게요.",
    );

  const reportMissedBus = () => {
    if (["wait", "arriving", "boardCheck"].includes(sim.scene)) {
      reply("버스를 놓쳤어", { ...sim, scene: "missedBus" });
      setTab("guide");
    } else if (inJourney) {
      ask("버스를 놓쳤어", "지금은 이미 버스를 타고 계신 것으로 확인돼요. 다르다면 안내 방송이나 기사님께 확인해 주세요.");
    } else {
      ask("버스를 놓쳤어", "지금은 기다리는 버스가 없어요. 목적지를 먼저 정해 주세요.");
    }
  };

  const reportMissedStop = () => {
    if ((sim.scene === "ride" && r <= 1) || sim.scene === "alightCheck") {
      reply("내릴 곳을 지나쳤어", { ...sim, scene: "missedStop", passed: DEST, uncertain: false, uncertainFrom: undefined });
      setTab("guide");
    } else if (sim.scene === "ride") {
      ask("내릴 곳을 지나쳤어", `아직 ${ROUTE.destination} 전이에요. ${kor(r)} 정거장 남았어요. 내리기 전에 먼저 알려 드릴게요.`);
    } else {
      ask("내릴 곳을 지나쳤어", "지금은 버스를 타고 계시지 않아요.");
    }
  };

  const reportWrongLocation = () => {
    if (sim.scene === "ride" && !sim.uncertain) {
      reply("위치가 이상해", { ...sim, uncertain: true, uncertainFrom: sim.passed });
      setTab("guide");
    } else {
      ask("위치가 이상해", whereNow(sim));
    }
  };

  const onCenterMic = () => {
    if (inJourney) setAskSheet((o) => !o);
    else startListening();
  };

  // ── 화면 ──
  const theme = alert ? "is-alert" : pocket ? "is-pocket" : "";
  const showCaption = caption && ((tab === "guide" && guideActive) || (tab === "home" && sim.scene === "confirm"));

  const homeScreen = (
    <section className="home">
      {inJourney ? (
        <button type="button" className="journey-banner" onClick={() => setTab("guide")}>
          <span className="route-chip is-light">{ROUTE.bus}</span>
          <span>
            <strong>{ROUTE.destination} 가는 길 안내 중</strong>
            <small>눌러서 안내 화면으로 돌아가기</small>
          </span>
          <span className="favorite-arrow">›</span>
        </button>
      ) : (
        <p className="greeting">김상용 님, 안녕하세요</p>
      )}
      <h1 className="main-title">어디로 가실 건가요?</h1>

      <button
        type="button"
        className={`voice-hero ${sim.scene === "listening" ? "is-listening" : ""}`}
        onClick={startListening}
        disabled={inJourney}
      >
        <span className="voice-hero-circle">
          <Icon name="mic" size={40} />
        </span>
        {sim.scene === "listening" ? (
          <span className="voice-hero-text">
            <strong>듣고 있어요</strong>
            <Wave active light />
          </span>
        ) : (
          <span className="voice-hero-text">
            <strong>눌러서 말하기</strong>
            <small>예: “명동 가려고”</small>
          </span>
        )}
      </button>

      {sim.homeNote && sim.scene === "home" && <p className="ai-note">{sim.homeNote}</p>}
      {inJourney && <p className="ai-note">안내 중에는 목적지를 바꿀 수 없어요. 바꾸시려면 안내를 끝내 주세요.</p>}

      <form className="type-form" onSubmit={submitTyped}>
        <label className="sr-only" htmlFor="dest-input">
          목적지 직접 입력
        </label>
        <span className="type-icon">
          <Icon name="search" size={22} />
        </span>
        <input id="dest-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="직접 입력하기" disabled={inJourney} />
        <button type="submit" disabled={inJourney}>
          찾기
        </button>
      </form>

      <h2 className="section-title">자주 가는 곳</h2>
      <div className="favorites">
        {settings.favorites.map((f) => (
          <button
            key={f.id}
            type="button"
            className="favorite"
            disabled={inJourney}
            onClick={() => (f.routeAvailable ? chooseRoute() : go({ ...sim, scene: "home", homeNote: ROUTE_UNAVAILABLE(f.name) }))}
          >
            <span className={`favorite-icon ${f.routeAvailable ? "" : "is-muted"}`}>
              <Icon name={f.icon} />
            </span>
            <span className="favorite-text">
              <strong>{f.name}</strong>
              <small>{f.detail}</small>
            </span>
            <span className="favorite-arrow">›</span>
          </button>
        ))}
        {settings.favorites.length === 0 && <p className="ai-note">자주 가는 곳이 없어요. 설정에서 다시 불러올 수 있어요.</p>}
      </div>

      {settings.recents.length > 0 && (
        <>
          <h2 className="section-title">최근 이동</h2>
          <div className="recent-card">
            <div className="recent-head">
              <span>{settings.recents[0].when}</span>
              {settings.recents.length > 1 && <small>최근 30일 {settings.recents.length}번 이용</small>}
            </div>
            <TripLine trip={settings.recents[0]} />
            <button type="button" className="secondary-button" onClick={chooseRoute} disabled={inJourney}>
              이 경로로 다시 안내
            </button>
          </div>
        </>
      )}
    </section>
  );

  const confirmScreen = (
    <section className="confirm">
      {userSaid && <p className="user-bubble">“{userSaid}”</p>}
      <p className="eyebrow">목적지 확인</p>
      <h1 className="main-title">자주 가시는 {ROUTE.place} 맞으세요?</h1>
      <div className="route-card">
        <div className="route-row">
          <span className="route-dot" />
          <div>
            <small>타는 곳</small>
            <strong>{ROUTE.origin} 정류장</strong>
          </div>
        </div>
        <div className="route-row is-bus">
          <span className="route-chip">{ROUTE.bus}</span>
          <div>
            <small>버스</small>
            <strong>
              {ROUTE.bus}번 · {DEST}정거장
            </strong>
          </div>
        </div>
        <div className="route-row">
          <span className="route-dot is-end" />
          <div>
            <small>내리는 곳</small>
            <strong>{ROUTE.destination}</strong>
          </div>
        </div>
      </div>
      <div className="button-pair">
        <button type="button" className="primary-button" onClick={startJourney}>
          네, 맞아요
        </button>
        <button type="button" className="secondary-button" onClick={() => reply("아니", { ...initialSim, homeNote: "알겠어요. 가고 싶은 곳을 다시 말씀해 주세요." })}>
          다시 말할게요
        </button>
      </div>
    </section>
  );

  const guideEmpty = (
    <section className="guide-empty">
      <span className="empty-icon">
        <Icon name="route" size={40} />
      </span>
      <h1 className="main-title">진행 중인 안내가 없어요</h1>
      <p className="question-sub">홈에서 목적지를 말씀하시면 이곳에서 버스 타는 것부터 내리는 것까지 함께해요.</p>
      <button type="button" className="primary-button" onClick={() => setTab("home")}>
        목적지 정하러 가기
      </button>
      {settings.recents.length > 0 && (
        <>
          <h2 className="section-title">최근 이동 경로</h2>
          <div className="recent-list">
            {settings.recents.slice(0, 3).map((t) => (
              <button key={t.id} type="button" className="recent-item" onClick={chooseRoute}>
                <span className="recent-when">{t.when}</span>
                <TripLine trip={t} />
                <span className="recent-action">다시 안내 ›</span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );

  const journeyScreen = (
    <>
      {(sim.scene === "wait" || sim.scene === "arriving" || sim.scene === "missedBus") && (
        <section className="wait">
          {userSaid && <p className="user-bubble">“{userSaid}”</p>}
          <div className={`wait-banner ${sim.scene === "arriving" ? "is-arriving" : ""}`}>
            <div className="wait-head">
              <span className="route-chip is-light">{ROUTE.bus}</span>
              <span>
                {ROUTE.origin} 정류장 → {ROUTE.destination}
              </span>
            </div>
            {sim.scene === "arriving" ? (
              <>
                <p className="wait-big">곧 도착해요</p>
                <p className="wait-sub">교통카드를 준비하고, 버스 앞 번호 {ROUTE.bus}번을 확인해 주세요.</p>
              </>
            ) : sim.scene === "missedBus" ? (
              <>
                <p className="wait-big">다음 차를 기다려요</p>
                <p className="wait-sub">괜찮아요. 다음 {ROUTE.bus}번 버스가 가까워지면 다시 알려 드릴게요.</p>
              </>
            ) : (
              <>
                <div className="wait-numbers">
                  <div>
                    <small>버스 위치</small>
                    <strong>
                      <em>{sim.busAway}</em>정거장 전
                    </strong>
                  </div>
                  <div>
                    <small>도착까지</small>
                    <strong>
                      약 <em>{etaMinutes(sim.busAway)}</em>분
                    </strong>
                  </div>
                </div>
                <div className="bus-track" aria-hidden="true">
                  {Array.from({ length: 6 }, (_, i) => 5 - i).map((n) => (
                    <span key={n} className={n === sim.busAway ? "is-bus" : n === 0 ? "is-me" : ""} />
                  ))}
                </div>
                <p className="wait-sub">정류장에서 기다려 주세요. 버스가 가까워지면 먼저 알려 드릴게요.</p>
              </>
            )}
          </div>
        </section>
      )}

      {sim.scene === "boardCheck" && (
        <section className="question">
          {userSaid && <p className="user-bubble">“{userSaid}”</p>}
          <span className="question-icon">
            <Icon name="bus" size={40} />
          </span>
          <h1 className="main-title">{ROUTE.bus}번 버스 타셨나요?</h1>
          <p className="question-sub">말로 “탔어”라고 하셔도 돼요.</p>
          <div className="button-pair">
            <button type="button" className="primary-button" onClick={() => reply("탔어", nextOf(sim))}>
              네, 탔어요
            </button>
            <button type="button" className="secondary-button" onClick={() => reply("못 탔어", { ...sim, scene: "missedBus" })}>
              아니요, 못 탔어요
            </button>
          </div>
        </section>
      )}

      {sim.scene === "ride" && !alert && (
        <section className="pocket">
          <p className="pocket-label">{ROUTE.destination}까지</p>
          {sim.uncertain ? (
            <p className="pocket-number is-unknown">위치 확인 중</p>
          ) : (
            <p className="pocket-number">
              <em>{r}</em>정거장
            </p>
          )}
          {sim.uncertain && <p className="question-sub">버스 안내 방송에서 정류장 이름을 확인해 주세요. 위치가 다시 확인되면 바로 알려 드릴게요.</p>}
          <ol className="pocket-timeline" hidden={sim.uncertain}>
            {[sim.passed, sim.passed + 1, DEST]
              .filter((v, i, arr) => arr.indexOf(v) === i && v <= DEST)
              .map((i) => (
                <li key={i} className={i <= sim.passed ? "is-past" : i === DEST ? "is-dest" : "is-next"}>
                  <span className="dot" />
                  <span className="stop">{stopName(i)}</span>
                  <span className="tag">
                    {i <= sim.passed ? "지남" : i === DEST ? "내릴 곳" : "다음"}
                    {i === LANDMARK && i > sim.passed ? " · 동부시장" : ""}
                  </span>
                </li>
              ))}
          </ol>
        </section>
      )}

      {alert && (
        <section className="alert-screen">
          <span className="alert-icon">
            <Icon name="bell" size={44} />
          </span>
          <h1>{r === 2 ? "두 정거장 뒤에 내려요" : "다음 정류장에서 내려요"}</h1>
          <p className="alert-sub">{r === 2 ? "소지품을 챙겨 주세요" : "손잡이를 잡고 안내 방송을 확인해 주세요"}</p>
          <ol className="alert-chain">
            {[sim.passed, sim.passed + 1, DEST]
              .filter((v, i, arr) => arr.indexOf(v) === i)
              .map((i) => (
                <li key={i} className={i <= sim.passed ? "is-past" : i === DEST ? "is-dest" : ""}>
                  <strong>{stopName(i)}</strong>
                  <small>{i <= sim.passed ? "지남" : i === DEST ? "내리는 곳" : "다음"}</small>
                </li>
              ))}
          </ol>
        </section>
      )}

      {(sim.scene === "alightCheck" || sim.scene === "altAlightCheck") && (
        <section className="question is-dark">
          {userSaid && <p className="user-bubble">“{userSaid}”</p>}
          <p className="pocket-label">{sim.uncertain ? "안내 방송을 확인해 주세요" : "도착"}</p>
          <h1 className="main-title">
            {sim.scene === "alightCheck" ? (sim.uncertain ? "정류장에 섰어요" : `${ROUTE.destination}예요`) : `${stopName(NEXT_AFTER_DEST)}이에요`}
          </h1>
          <p className="question-sub">내리셨나요?</p>
          <div className="button-pair">
            <button type="button" className="primary-button is-amber" onClick={() => reply("내렸어", nextOf(sim))}>
              네, 내렸어요
            </button>
            <button
              type="button"
              className="secondary-button is-dark"
              onClick={() =>
                sim.scene === "alightCheck"
                  ? reply("못 내렸어", { ...sim, scene: "missedStop", uncertain: false, uncertainFrom: undefined })
                  : ask("아직이야", "괜찮아요. 버스가 완전히 선 다음에 손잡이를 잡고 천천히 내리시면 돼요.")
              }
            >
              아니요, 아직이요
            </button>
          </div>
        </section>
      )}

      {sim.scene === "missedStop" && (
        <section className="question is-dark">
          {userSaid && <p className="user-bubble">“{userSaid}”</p>}
          <p className="pocket-label">괜찮아요</p>
          <h1 className="main-title">급하게 내리지 마세요</h1>
          <p className="question-sub">
            다음 정류장 <strong>{stopName(NEXT_AFTER_DEST)}</strong>에서 내리시면 돌아가는 길을 알려 드릴게요.
          </p>
        </section>
      )}

      {(sim.scene === "returnGuide" || sim.scene === "done") && (
        <section className="done">
          {userSaid && <p className="user-bubble">“{userSaid}”</p>}
          <span className="done-icon">
            <Icon name={sim.scene === "done" ? "check" : "pin"} size={48} />
          </span>
          {sim.scene === "returnGuide" ? (
            <>
              <h1 className="main-title">{ROUTE.destination}는 한 정거장 거리예요</h1>
              <p className="question-sub">버스가 지나온 쪽으로 가시면 돼요. 헷갈리시면 주변 분께 명동 방향을 여쭤보셔도 좋아요.</p>
            </>
          ) : (
            <>
              <h1 className="main-title">{ROUTE.place}에 도착했어요</h1>
              <p className="question-sub">안내를 마쳤어요. 위치 확인도 멈췄어요.</p>
              {settings.guardian ? (
                <div className="guardian-card">
                  <span className="guardian-icon">
                    <Icon name="shield" size={24} />
                  </span>
                  <div>
                    <strong>보호자 {GUARDIAN.name} 님께 도착을 알렸어요</strong>
                    <p className="sms-bubble">
                      [길벗] 김상용 님이 {arrivedAt}에{" "}
                      {sim.passed === NEXT_AFTER_DEST ? `${stopName(NEXT_AFTER_DEST)} 정류장(명동 근처)` : `${ROUTE.destination} 정류장`}에 도착하셨어요.
                    </p>
                    <small>도착 장소와 시각만 보냈어요</small>
                  </div>
                </div>
              ) : (
                <p className="settings-note is-card">보호자 도착 문자가 꺼져 있어요. 설정에서 켤 수 있어요.</p>
              )}
              <button type="button" className="primary-button" onClick={() => resetToHome()}>
                처음으로
              </button>
            </>
          )}
        </section>
      )}
    </>
  );

  const helpItem = (icon: IconName, title: string, sub: string, onClick: () => void) => (
    <button type="button" className="help-item" onClick={onClick}>
      <span className="help-icon">
        <Icon name={icon} size={24} />
      </span>
      <span className="favorite-text">
        <strong>{title}</strong>
        <small>{sub}</small>
      </span>
    </button>
  );

  const helpScreen = (
    <section className="help">
      <p className="eyebrow">AI 도움</p>
      <h1 className="main-title">무엇을 도와드릴까요?</h1>
      {inJourney && (
        <button type="button" className="journey-banner is-compact" onClick={() => setTab("guide")}>
          <span className="route-chip is-light">{ROUTE.bus}</span>
          <span>
            <strong>{SCENE_LABEL[sim.scene]}</strong>
            <small>{ROUTE.destination} 가는 길</small>
          </span>
          <span className="favorite-arrow">›</span>
        </button>
      )}
      {helpAnswer && (
        <div className="help-answer" aria-live="polite">
          {userSaid && <p className="user-bubble">“{userSaid}”</p>}
          <div className="help-answer-body">
            <span className="assistant-mark">길</span>
            <p>{helpAnswer}</p>
          </div>
        </div>
      )}

      <h2 className="section-title">지금 상황 물어보기</h2>
      <div className="help-grid">
        {helpItem("pin", "지금 어디야?", "현재 위치와 상황", () => ask("지금 어디야?", whereNow(sim)))}
        {helpItem("volume", "다시 알려줘", "지금 안내 다시 듣기", () => ask("다시 알려줘", describeNow(sim)))}
        {helpItem("bus", "얼마나 남았어?", "버스·도착까지 남은 시간", () => ask("얼마나 남았어?", howLong(sim)))}
        {helpItem("bell", "도착 전에 알려줘", "내리기 전 진동과 소리", askArrivalAlert)}
      </div>

      <h2 className="section-title">문제가 생겼어요</h2>
      <div className="help-list">
        {helpItem("alert", "버스를 놓쳤어", "다음 버스를 다시 찾아 드려요", reportMissedBus)}
        {helpItem("route", "내릴 곳을 지나쳤어", "안전하게 내릴 곳을 알려 드려요", reportMissedStop)}
        {helpItem("pin", "위치가 이상해", "안내 방송 기준으로 바꿔 안내해요", reportWrongLocation)}
      </div>

      <div className="uncertainty-note">
        <Icon name="shield" size={20} />
        <p>위치나 버스를 확실히 알 수 없을 때는 단정하지 않고, 안내 방송이나 기사님께 확인하도록 안내해요.</p>
      </div>
    </section>
  );

  return (
    <div className="stage">
      <main className={`phone ${theme}`} aria-live="polite">
        <div className="status-bar" aria-hidden="true">
          <span>9:41</span>
          <span className="status-icons">
            <i />
            <i />
            <b />
          </span>
        </div>

        {vibe && (
          <div key={vibe.id} className="vibe-flash" role="status">
            <Icon name="phone" size={22} />
            <span>진동 · {vibe.label}</span>
          </div>
        )}

        {onGuide && inJourney && (
          <header className="topbar">
            <span className="topbar-label">{alert ? "하차 준비" : pocket ? "주머니 모드" : SCENE_LABEL[sim.scene]}</span>
            <div className="topbar-actions">
              {navHidden && (
                <button type="button" className="ghost-button" onClick={() => setTab("home")}>
                  <Icon name="home" size={20} />홈
                </button>
              )}
              <button type="button" className="ghost-button" onClick={() => setEndConfirm(true)}>
                <Icon name="close" size={20} />
                안내 종료
              </button>
            </div>
          </header>
        )}

        {tab === "settings" ? (
          <SettingsScreen settings={settings} onChange={setSettings} />
        ) : (
          <div className="screen" ref={screenRef}>
            {tab === "home" && (sim.scene === "confirm" ? confirmScreen : homeScreen)}
            {tab === "guide" && (guideActive ? journeyScreen : guideEmpty)}
            {tab === "help" && helpScreen}
          </div>
        )}

        {showCaption && (
          <section className={`caption ${speaking ? "is-speaking" : ""}`} aria-label="음성 안내 자막">
            <Wave active={speaking} light={pocket || alert} />
            <p>{caption}</p>
          </section>
        )}

        {askSheet && inJourney && (
          <div className="ask-sheet">
            <button type="button" onClick={() => ask("다시 알려줘", describeNow(sim))}>
              “다시 알려줘”
            </button>
            <button type="button" onClick={() => ask("얼마나 남았어?", howLong(sim))}>
              “얼마나 남았어?”
            </button>
          </div>
        )}

        {navHidden ? (
          <div className="voice-dock">
            <button type="button" className={`voice-pill ${askSheet ? "is-open" : ""}`} onClick={() => setAskSheet((o) => !o)}>
              <Icon name="mic" size={26} />
              <span>{askSheet ? "무엇을 도와드릴까요?" : "말하기"}</span>
              <Wave active={askSheet} light />
            </button>
          </div>
        ) : (
          <nav className="bottom-nav" aria-label="주요 메뉴">
            {TABS.slice(0, 2).map((t) => (
              <button
                key={t.id}
                type="button"
                className={tab === t.id ? "is-active" : ""}
                aria-current={tab === t.id ? "page" : undefined}
                aria-label={t.label}
                title={t.label}
                onClick={() => setTab(t.id)}
              >
                <span className="nav-icon">
                  <Icon name={t.icon} size={24} />
                  {t.id === "guide" && inJourney && <i className="nav-dot" />}
                </span>
              </button>
            ))}
            <button
              type="button"
              className={`nav-mic ${sim.scene === "listening" || askSheet ? "is-on" : ""}`}
              onClick={onCenterMic}
              aria-label={inJourney ? "AI에게 물어보기" : "말로 목적지 정하기"}
            >
              <span className="nav-mic-circle">
                <Icon name="mic" size={30} />
              </span>
            </button>
            {TABS.slice(2).map((t) => (
              <button
                key={t.id}
                type="button"
                className={tab === t.id ? "is-active" : ""}
                aria-current={tab === t.id ? "page" : undefined}
                aria-label={t.label}
                title={t.label}
                onClick={() => setTab(t.id)}
              >
                <span className="nav-icon">
                  <Icon name={t.icon} size={24} />
                </span>
              </button>
            ))}
          </nav>
        )}

        {endConfirm && (
          <div className="sheet-backdrop" onClick={() => setEndConfirm(false)}>
            <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h2>안내를 끝낼까요?</h2>
              <p>끝내면 위치 확인과 알림도 멈춰요. 안내는 그대로 두고 다른 화면을 보시려면 아래 메뉴를 이용해 주세요.</p>
              <div className="button-pair">
                <button type="button" className="primary-button is-danger" onClick={() => resetToHome("안내를 마쳤어요. 다른 곳에 가시려면 말씀해 주세요.")}>
                  안내 끝내기
                </button>
                <button type="button" className="secondary-button" onClick={() => setEndConfirm(false)}>
                  계속 안내받기
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
