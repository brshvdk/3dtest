/**
 * 3D-визуализация активной комнаты: стены с толщиной и проёмами, модели
 * дверей/окон/мебели, плинтус по профилю с косыми резами, пол с раскладкой.
 * Рендер по требованию (frameloop="demand"): кадр рисуется только при
 * изменениях и взаимодействии. Модуль грузится лениво (Stage).
 */
import {
  Component,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ACESFilmicToneMapping } from "three";
import { useActiveRoom, useWalls } from "../state/hooks";
import { useAppStore } from "../state/store";
import { Button, Icon, useMediaQuery } from "../ui/kit";
import { LOW_WALL_HEIGHT } from "./build/walls";
import { NO_CLIP, SceneContext, SceneRegistry, createClipPlane, type SceneCtx } from "./context";
import { CameraRig } from "./parts/CameraRig";
import { Base, Ceiling, Floor } from "./parts/Floor";
import { Environment, Lights } from "./parts/Lights";
import { Openings } from "./parts/Openings";
import { Skirting } from "./parts/Skirting";
import { WallLabels } from "./parts/WallLabels";
import { Walls } from "./parts/Walls";
import {
  setHoverInfo,
  useHoverInfo,
  useView3d,
  type CameraPreset,
  type Flash as FlashInfo,
  type WallMode,
} from "./sceneState";
import { useSceneTheme, type SceneTheme } from "./theme";
import "./scene3d.css";

/* ------------------------------ Сцена -------------------------------- */

function SceneRoot({ theme, onContextLost }: { theme: SceneTheme; onContextLost: (lost: boolean) => void }) {
  const room = useActiveRoom();
  const walls = useWalls();
  const wallMode = useView3d((s) => s.wallMode);
  const labels = useView3d((s) => s.labels);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);

  // Потеря WebGL-контекста (сброс видеокарты, нехватка памяти): three сам просит
  // браузер вернуть контекст. Вернул — перерисовать кадр (рендер по требованию)
  // и заново построить окружение: его карта жила только в видеопамяти.
  const [glGen, setGlGen] = useState(0);
  useEffect(() => {
    const el = gl.domElement;
    const lost = () => onContextLost(true);
    const restored = () => {
      onContextLost(false);
      setGlGen((g) => g + 1);
      invalidate();
    };
    el.addEventListener("webglcontextlost", lost);
    el.addEventListener("webglcontextrestored", restored);
    return () => {
      el.removeEventListener("webglcontextlost", lost);
      el.removeEventListener("webglcontextrestored", restored);
    };
  }, [gl, invalidate, onContextLost]);

  const registry = useMemo(() => new SceneRegistry(), []);
  const clip = useMemo(() => createClipPlane(), []);
  const ctx = useMemo<SceneCtx>(() => ({ theme, clip, registry }), [theme, clip, registry]);

  const top = wallMode === "low" ? Math.min(LOW_WALL_HEIGHT, room.height) : room.height;
  useLayoutEffect(() => {
    registry.interior = { points: room.points, height: room.height };
    invalidate();
  }, [registry, room.points, room.height, invalidate]);
  useLayoutEffect(() => {
    clip.constant = wallMode === "low" ? top + 0.001 : NO_CLIP;
    invalidate();
  }, [clip, wallMode, top, invalidate]);

  return (
    <SceneContext.Provider value={ctx}>
      <color attach="background" args={[theme.bg]} />
      <Environment key={glGen} intensity={theme.dark ? 0.42 : 0.5} />
      <Lights room={room} />
      <Floor room={room} />
      <Base room={room} />
      {wallMode !== "low" ? <Ceiling room={room} /> : null}
      <Walls room={room} walls={walls} mode={wallMode} />
      <Openings room={room} walls={walls} mode={wallMode} />
      {room.skirtingEnabled ? <Skirting roomId={room.id} /> : null}
      {labels ? (
        <WallLabels walls={walls} roomId={room.id} top={top} points={room.points} ceiling={room.height} />
      ) : null}
      <CameraRig room={room} wallTop={top} />
    </SceneContext.Provider>
  );
}

/* ----------------------------- Оверлей -------------------------------- */

/** short — подпись под иконкой на узком виде (телефон, «Оба»): без наведения назначение не узнать. */
const PRESETS: Array<{
  id: CameraPreset;
  label: string;
  short: string;
  icon: "cube" | "plan" | "eye";
  title: string;
  flash: string;
}> = [
  {
    id: "persp",
    label: "Перспектива",
    short: "Обзор",
    icon: "cube",
    title: "Вся комната целиком",
    flash: "Перспектива — вся комната",
  },
  { id: "top", label: "Сверху", short: "Сверху", icon: "plan", title: "Вид сверху, как на плане", flash: "Вид сверху" },
  {
    id: "entry",
    label: "От входа",
    short: "Вход",
    icon: "eye",
    title: "Как видно, если войти в комнату",
    flash: "Вид от входа",
  },
];

const WALL_MODES: Array<{
  id: WallMode;
  label: string;
  icon: "walls-auto" | "walls-full" | "walls-low";
  title: string;
  flash: string;
}> = [
  {
    id: "auto",
    label: "Авто",
    icon: "walls-auto",
    title: "Скрывать стены, которые загораживают комнату",
    flash: "Стены: авто — ближние скрываются",
  },
  { id: "all", label: "Все", icon: "walls-full", title: "Показывать все стены целиком", flash: "Стены: все" },
  { id: "low", label: "Низкие", icon: "walls-low", title: "Стены по колено — всё видно сверху", flash: "Стены: низкие — всё видно сверху" },
];

const NO_DOOR_TITLE = "В комнате нет двери — встанем у самой длинной стены";

/**
 * Сколько подписей помещается в панель (вид шире 560 px; уже — свой
 * компактный вид в CSS): «full» — все подписи в строку; «stack» — у режимов
 * стен подпись под иконкой; «stack-short» — то же, а ракурсы с короткими
 * подписями; «icons» — у режимов одни иконки (запасной вариант). Выбираем
 * по факту — самый подробный ярус, при котором панель не переполнена:
 * ширина подписей зависит от шрифта и масштаба, порог по ширине вида её
 * не угадает.
 */
type ToolbarFit = "full" | "stack" | "stack-short" | "icons";
const TOOLBAR_FITS: ToolbarFit[] = ["full", "stack", "stack-short", "icons"];

function useToolbarFit(ref: RefObject<HTMLDivElement>) {
  useLayoutEffect(() => {
    const bar = ref.current;
    const host = bar?.parentElement;
    if (!bar || !host) return;
    let lastWidth = -1;
    const fit = (force = false) => {
      const w = host.clientWidth;
      if (!force && w === lastWidth) return;
      lastWidth = w;
      let chosen: ToolbarFit = "icons";
      // Группы кнопок сжимаются (min-width: 0) — переполнение видно по ним, а не по панели.
      const overflows = (el: Element) => el.scrollWidth > el.clientWidth + 1;
      for (const f of TOOLBAR_FITS) {
        bar.dataset.fit = f;
        if (!overflows(bar) && !Array.from(bar.children).some(overflows)) {
          chosen = f;
          break;
        }
      }
      bar.dataset.fit = chosen;
      // Подпись «что включилось» над панелью нужна, только если у режимов нет текста в строку.
      host.dataset.tbfit = chosen;
    };
    fit(true);
    const ro = new ResizeObserver(() => fit());
    ro.observe(host);
    let alive = true;
    // Шрифт догрузился — ширина подписей другая.
    document.fonts?.ready.then(() => alive && fit(true)).catch(() => undefined);
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [ref]);
}

function Toolbar() {
  const activePreset = useView3d((s) => s.activePreset);
  const wallMode = useView3d((s) => s.wallMode);
  const labels = useView3d((s) => s.labels);
  const hasEntrance = useAppStore((s) => {
    const room = s.project.rooms.find((r) => r.id === s.activeRoomId);
    return !!room?.openings.some((o) => o.kind === "door" || o.kind === "passage" || o.kind === "balcony");
  });

  const handlers = useMemo(() => {
    const v = () => useView3d.getState();
    return {
      preset: (p: (typeof PRESETS)[number], noDoor: boolean) => {
        v().goTo(p.id);
        v().showFlash(p.id === "entry" && noDoor ? "Нет двери — смотрим от длинной стены" : p.flash, "view");
      },
      walls: (m: (typeof WALL_MODES)[number]) => {
        v().setWallMode(m.id);
        v().showFlash(m.flash, "walls");
      },
      labels: () => {
        v().toggleLabels();
        v().showFlash(v().labels ? "Подписи стен показаны" : "Подписи стен скрыты", "labels");
      },
    };
  }, []);

  const ref = useRef<HTMLDivElement>(null);
  useToolbarFit(ref);

  return (
    <div className="s3d-toolbar" ref={ref} role="toolbar" aria-label="Управление 3D-видом">
      <div className="s3d-toolbar__group" role="group" aria-label="Ракурс">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`s3d-tbtn s3d-tbtn--view${activePreset === p.id ? " is-active" : ""}`}
            onClick={() => handlers.preset(p, !hasEntrance)}
            title={p.id === "entry" && !hasEntrance ? NO_DOOR_TITLE : p.title}
            aria-label={p.label}
            aria-pressed={activePreset === p.id}
          >
            <Icon name={p.icon} size={17} />
            <span className="s3d-tbtn__text">{p.label}</span>
            <span className="s3d-tbtn__short">{p.short}</span>
          </button>
        ))}
      </div>
      <span className="s3d-toolbar__sep" aria-hidden />
      <div className="s3d-toolbar__group" role="radiogroup" aria-label="Стены">
        <span className="s3d-toolbar__caption" aria-hidden>
          Стены
        </span>
        {WALL_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={wallMode === m.id}
            className={`s3d-tbtn s3d-tbtn--mode${wallMode === m.id ? " is-active" : ""}`}
            onClick={() => handlers.walls(m)}
            title={`Стены: ${m.label.toLowerCase()}. ${m.title}`}
            aria-label={`Стены: ${m.label.toLowerCase()}`}
          >
            <Icon name={m.icon} size={17} />
            <span className="s3d-tbtn__text s3d-tbtn__text--mode">{m.label}</span>
            <span className="s3d-tbtn__short">{m.label}</span>
          </button>
        ))}
      </div>
      <span className="s3d-toolbar__sep" aria-hidden />
      <button
        type="button"
        className={`s3d-tbtn s3d-tbtn--icon${labels ? " is-active" : ""}`}
        onClick={handlers.labels}
        aria-pressed={labels}
        aria-label="Подписи стен"
        title={labels ? "Скрыть подписи стен" : "Показать подписи стен"}
      >
        <Icon name="tag" size={17} />
        <span className="s3d-tbtn__short">Подписи</span>
      </button>
    </div>
  );
}

/**
 * Подпись над панелью после нажатия: на узком виде кнопки — одни иконки,
 * и так сразу видно, что включилось. Для экранных дикторов — всегда.
 */
function Flash() {
  const flash = useView3d((s) => s.flash);
  const [shown, setShown] = useState<FlashInfo | null>(null);
  useEffect(() => {
    if (!flash) return;
    setShown(flash);
    const t = window.setTimeout(() => setShown(null), 1600);
    return () => window.clearTimeout(t);
  }, [flash]);
  return (
    <div className="s3d-flash-host" aria-live="polite">
      {shown ? (
        <div key={shown.seq} className={`s3d-flash s3d-flash--${shown.kind}`}>
          {shown.text}
        </div>
      ) : null}
    </div>
  );
}

const HINTS = {
  mouse: [
    ["Тяните", "вращать"],
    ["Колесо", "масштаб"],
    ["Правая кнопка", "сдвиг"],
    ["Клик", "выбрать стену или дверь"],
  ],
  touch: [
    ["Палец", "вращать"],
    ["Два пальца", "масштаб"],
    ["Касание", "выбрать"],
  ],
} as const;

function Hint() {
  const seen = useView3d((s) => s.hintSeen);
  const dismiss = useView3d((s) => s.dismissHint);
  const touch = useMediaQuery("(hover: none)");

  if (seen) return null;
  const items = touch ? HINTS.touch : HINTS.mouse;
  return (
    <div className="s3d-hint" role="note">
      <Icon name="info" size={15} className="s3d-hint__icon" />
      <p className="s3d-hint__text">
        {items.map(([key, what], i) => (
          <Fragment key={key}>
            {i > 0 ? (
              <span className={`s3d-hint__dot${i >= 2 ? " s3d-hint__item--extra" : ""}`}>{"\u00a0· "}</span>
            ) : null}
            <span className={`s3d-hint__item${i >= 2 ? " s3d-hint__item--extra" : ""}`}>
              <b>{key}</b> — {what}
            </span>
          </Fragment>
        ))}
      </p>
      <button type="button" className="s3d-hint__close" onClick={dismiss} aria-label="Скрыть подсказку" title="Понятно, скрыть">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

function RoomNote() {
  const disabled = useAppStore((s) => {
    const room = s.project.rooms.find((r) => r.id === s.activeRoomId);
    return room ? !room.skirtingEnabled : false;
  });
  if (!disabled) return null;
  return (
    <div className="s3d-note" role="status">
      Комната не участвует в расчёте — плинтус не показан
    </div>
  );
}

/**
 * Верхний левый столбик: подсказка по управлению и плашка о комнате.
 * Кадр вписывается ниже него — сообщаем камере, сколько места он занимает.
 */
function TopStack({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const setInset = useView3d.getState().setInsetTop;
    if (!el) return;
    const measure = () => setInset(el.childElementCount ? el.offsetTop + el.offsetHeight : 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Содержимое может смениться без смены размера (одна плашка вместо другой).
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      setInset(0);
    };
  }, []);
  return (
    <div className="s3d-top" ref={ref}>
      {children}
    </div>
  );
}

/** Подсказка у курсора: что под ним (стена, проём, участок плинтуса). */
function Tooltip({ elRef }: { elRef: RefObject<HTMLDivElement> }) {
  const info = useHoverInfo();
  return (
    <div
      ref={elRef}
      className={`s3d-tip${info ? " is-visible" : ""}${info?.tone === "skirting" ? " s3d-tip--skirting" : ""}`}
      aria-hidden
    >
      {info ? (
        <>
          <span className="s3d-tip__title">{info.title}</span>
          {info.sub ? <span className="s3d-tip__sub">{info.sub}</span> : null}
        </>
      ) : null}
    </div>
  );
}

/* ------------------------- Ошибки и поддержка ------------------------- */

let webglCache: boolean | null = null;

/** Есть ли WebGL. Проверочный контекст сразу освобождаем: браузер держит их не больше ~16. */
function webglAvailable(): boolean {
  if (webglCache !== null) return webglCache;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    webglCache = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglCache = false;
  }
  return webglCache;
}

function Fallback({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const setView = useAppStore((s) => s.setView);
  return (
    <div className="s3d-fallback">
      <div className="s3d-fallback__icon">
        <Icon name="cube" size={26} />
      </div>
      <div className="s3d-fallback__title">3D-вид недоступен</div>
      <div className="s3d-fallback__text">{text}</div>
      <div className="s3d-fallback__actions">
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Попробовать снова
          </Button>
        ) : null}
        <Button variant="primary" size="sm" icon="plan" onClick={() => setView("plan")}>
          Открыть план
        </Button>
      </div>
    </div>
  );
}

class SceneBoundary extends Component<{ children: ReactNode }, { error: boolean; key: number }> {
  state = { error: false, key: 0 };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(err: unknown) {
    console.error("3D:", err);
  }
  render() {
    if (this.state.error) {
      return (
        <Fallback
          text="Не получилось нарисовать сцену. Расчёт и план работают как обычно."
          onRetry={() => this.setState((s) => ({ error: false, key: s.key + 1 }))}
        />
      );
    }
    return <div key={this.state.key} style={{ position: "absolute", inset: 0 }}>{this.props.children}</div>;
  }
}

/* ------------------------------ Корень -------------------------------- */

/** Сколько ждём, пока браузер вернёт потерянный WebGL-контекст, мс. */
const CONTEXT_WAIT = 3000;

export default function Scene3D() {
  const theme = useSceneTheme();
  const supported = useMemo(webglAvailable, []);
  const tipRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Контекст потерян и не вернулся — предлагаем пересоздать холст (новый key).
  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const lostTimer = useRef(0);
  const onContextLost = useCallback((lost: boolean) => {
    window.clearTimeout(lostTimer.current);
    if (lost) lostTimer.current = window.setTimeout(() => setContextLost(true), CONTEXT_WAIT);
    else setContextLost(false);
  }, []);
  useEffect(() => () => window.clearTimeout(lostTimer.current), []);

  // Уход курсора со сцены — убрать подсказку и подсветку участка.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const leave = () => {
      setHoverInfo(null);
      const st = useAppStore.getState();
      if (st.hoverSegmentId) st.setHoverSegment(null);
    };
    el.addEventListener("pointerleave", leave);
    return () => el.removeEventListener("pointerleave", leave);
  }, []);

  // Пока камеру тянут, подсказка у курсора не нужна (иначе она «едет» за поворотом).
  const press = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    press.current = { x: e.clientX, y: e.clientY };
  };
  useEffect(() => {
    const release = () => {
      press.current = null;
      rootRef.current?.classList.remove("is-dragging");
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const tip = tipRef.current;
    const root = rootRef.current;
    if (!tip || !root) return;
    const p = press.current;
    if (p && Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 4 && !root.classList.contains("is-dragging")) {
      root.classList.add("is-dragging");
    }
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const flipX = x + 16 + w > r.width - 8;
    // У нижнего края (панель) — над курсором.
    const flipY = y + 20 + h > r.height - 62;
    tip.style.transform = `translate(${Math.round(flipX ? x - 14 - w : x + 14)}px, ${Math.round(flipY ? y - 12 - h : y + 18)}px)`;
  };

  if (!supported) {
    return (
      <div className="s3d">
        <Fallback text="Браузер или устройство не поддерживает WebGL. Расчёт и план работают как обычно." />
      </div>
    );
  }

  if (contextLost) {
    return (
      <div className="s3d">
        <Fallback
          text="Видеокарта сбросила 3D-вид и не вернула его. Расчёт и план работают как обычно."
          onRetry={() => {
            setContextLost(false);
            setCanvasKey((k) => k + 1);
          }}
        />
      </div>
    );
  }

  return (
    <div className="s3d" ref={rootRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
      <SceneBoundary>
        <Canvas
          key={canvasKey}
          className="s3d__canvas"
          frameloop="demand"
          shadows
          dpr={[1, 2]}
          camera={{ fov: 38, near: 0.05, far: 400, position: [8, 7, 10] }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            gl.localClippingEnabled = true;
            gl.toneMapping = ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;
          }}
          onPointerMissed={() => {
            useAppStore.getState().select(null);
            setHoverInfo(null);
          }}
          aria-label="3D-вид комнаты"
        >
          <SceneRoot theme={theme} onContextLost={onContextLost} />
        </Canvas>
      </SceneBoundary>
      <TopStack>
        <Hint />
        <RoomNote />
      </TopStack>
      <Flash />
      <Toolbar />
      <Tooltip elRef={tipRef} />
    </div>
  );
}
