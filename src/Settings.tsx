import { useState } from "react";
import { Icon, type IconName } from "./icons";

export type Favorite = { id: string; name: string; detail: string; icon: IconName; routeAvailable: boolean };

export type Trip = { id: string; from: string; to: string; bus: string; when: string };

export type AppSettings = {
  voice: boolean;
  rate: "slow" | "normal";
  vibration: boolean;
  guardian: boolean;
  favorites: Favorite[];
  recents: Trip[];
};

export const GUARDIAN = { name: "김민수", relation: "아들", phone: "010-****-4821" };

export const DEFAULT_FAVORITES: Favorite[] = [
  { id: "myeongdong", name: "명동", detail: "3번 버스 · 명동입구 하차", icon: "pin", routeAvailable: true },
  { id: "sacredheart", name: "춘천성심병원", detail: "정기 진료", icon: "hospital", routeAvailable: false },
];

export const DEFAULT_SETTINGS: AppSettings = {
  voice: true,
  rate: "normal",
  vibration: true,
  guardian: true,
  favorites: DEFAULT_FAVORITES,
  recents: [
    { id: "t3", from: "후평동종점", to: "명동입구", bus: "3", when: "어제" },
    { id: "t2", from: "후평동종점", to: "명동입구", bus: "3", when: "11월 18일" },
    { id: "t1", from: "후평동종점", to: "명동입구", bus: "3", when: "11월 14일" },
  ],
};

const STORAGE_KEY = "itda-settings-v3";

export function loadSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // 저장이 안 되는 환경이면 이번 실행 동안만 유지
  }
}

function Toggle({ label, desc, on, onChange }: { label: string; desc?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="setting-row" onClick={() => onChange(!on)}>
      <span className="setting-text">
        <strong>{label}</strong>
        {desc && <small>{desc}</small>}
      </span>
      <span className={`switch ${on ? "is-on" : ""}`} aria-hidden="true">
        <i />
      </span>
      <span className="switch-state">{on ? "켜짐" : "꺼짐"}</span>
    </button>
  );
}

export function SettingsScreen({
  settings,
  onChange,
  onClose,
}: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onClose?: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<AppSettings>) => onChange({ ...settings, ...patch });

  return (
    <div className={`settings ${onClose ? "" : "is-tab"}`} role={onClose ? "dialog" : undefined} aria-labelledby="settings-title">
      <header className="settings-head">
        <h1 id="settings-title">설정</h1>
        {onClose && (
          <button type="button" className="ghost-button" onClick={onClose}>
            <Icon name="close" size={22} />
            닫기
          </button>
        )}
      </header>

      <div className="settings-body">
        <section className="profile-card">
          <span className="avatar">김</span>
          <p>
            <strong>김상용 님</strong>
            <small>71세 · 춘천시 후평동</small>
          </p>
        </section>

        <h2 className="settings-section">안내 방식</h2>
        <div className="settings-group">
          <Toggle label="음성 안내" desc="이동 중 상황을 말로 알려 드려요" on={settings.voice} onChange={(v) => set({ voice: v })} />
          <div className="setting-row is-static">
            <span className="setting-text">
              <strong>말하기 속도</strong>
              <small>안내 문장을 읽는 빠르기</small>
            </span>
            <span className="segmented" role="radiogroup" aria-label="말하기 속도">
              <button type="button" role="radio" aria-checked={settings.rate === "slow"} className={settings.rate === "slow" ? "is-on" : ""} onClick={() => set({ rate: "slow" })}>
                천천히
              </button>
              <button type="button" role="radio" aria-checked={settings.rate === "normal"} className={settings.rate === "normal" ? "is-on" : ""} onClick={() => set({ rate: "normal" })}>
                보통
              </button>
            </span>
          </div>
          <Toggle label="진동 알림" desc="버스 도착과 하차 전에 진동으로 알려 드려요" on={settings.vibration} onChange={(v) => set({ vibration: v })} />
          <div className="setting-row is-static">
            <span className="setting-text">
              <strong>하차 알림 시점</strong>
              <small>두 정거장 전(짧게-짧게) · 한 정거장 전(길게)</small>
            </span>
          </div>
        </div>

        <h2 className="settings-section">보호자 안심 문자</h2>
        <div className="settings-group">
          <Toggle
            label="도착하면 보호자에게 알리기"
            desc={`${GUARDIAN.name}(${GUARDIAN.relation}) · ${GUARDIAN.phone}`}
            on={settings.guardian}
            onChange={(v) => set({ guardian: v })}
          />
          <p className="settings-note">
            목적지에 도착했을 때만 <strong>도착 장소와 시각</strong>을 보내요. 이동 경로나 실시간 위치는 보내지 않아요.
          </p>
          {settings.guardian && (
            <div className="sms-preview" aria-label="문자 미리보기">
              <small>보내는 문자 예시</small>
              <p>[잇다] 김상용 님이 오후 2:14에 명동입구 정류장에 도착하셨어요.</p>
            </div>
          )}
        </div>

        <h2 className="settings-section">자주 가는 곳</h2>
        <div className="settings-group">
          {settings.favorites.length === 0 && <p className="settings-note">저장된 장소가 없어요.</p>}
          {settings.favorites.map((f) => (
            <div key={f.id} className="setting-row is-static">
              <span className="favorite-icon">
                <Icon name={f.icon} />
              </span>
              <span className="setting-text">
                <strong>{f.name}</strong>
                <small>{f.detail}</small>
              </span>
              <button type="button" className="text-button" onClick={() => set({ favorites: settings.favorites.filter((x) => x.id !== f.id) })}>
                삭제
              </button>
            </div>
          ))}
          {settings.favorites.length < DEFAULT_FAVORITES.length && (
            <button type="button" className="text-button is-block" onClick={() => set({ favorites: DEFAULT_FAVORITES })}>
              기본 장소 다시 불러오기
            </button>
          )}
        </div>

        <h2 className="settings-section">권한</h2>
        <div className="settings-group">
          <div className="setting-row is-static">
            <span className="favorite-icon">
              <Icon name="pin" />
            </span>
            <span className="setting-text">
              <strong>위치</strong>
              <small>길 안내 중에만 사용해요</small>
            </span>
            <span className="status-chip">허용됨</span>
          </div>
          <div className="setting-row is-static">
            <span className="favorite-icon">
              <Icon name="mic" />
            </span>
            <span className="setting-text">
              <strong>마이크</strong>
              <small>말하기 버튼을 누를 때만 들어요</small>
            </span>
            <span className="status-chip">허용됨</span>
          </div>
          <p className="settings-note">권한은 휴대폰 설정 → 애플리케이션 → 잇다에서 바꿀 수 있어요.</p>
        </div>

        <h2 className="settings-section">개인정보 · 이동 기록</h2>
        <div className="settings-group">
          <div className="setting-row is-static">
            <span className="setting-text">
              <strong>저장된 이동 기록 {settings.recents.length}건</strong>
              <small>최근 30일 · 출발지, 목적지, 이용 버스만 저장</small>
            </span>
          </div>
          <p className="settings-note">안내가 끝나면 위치 확인을 멈추고, 지나온 경로의 위치 정보는 저장하지 않아요.</p>
          {confirmDelete ? (
            <div className="delete-confirm">
              <p>이동 기록 {settings.recents.length}건을 모두 지울까요? 지우면 되돌릴 수 없어요.</p>
              <div className="button-pair">
                <button
                  type="button"
                  className="primary-button is-danger"
                  onClick={() => {
                    set({ recents: [] });
                    setConfirmDelete(false);
                  }}
                >
                  모두 지우기
                </button>
                <button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)}>
                  취소
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="text-button is-block is-danger" disabled={settings.recents.length === 0} onClick={() => setConfirmDelete(true)}>
              이동 기록 모두 지우기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
