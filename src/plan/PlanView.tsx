/**
 * 2D-редактор плана — главный инструмент «построй свою комнату».
 *
 * Слои (снизу вверх): сетка → пол, мебель, стены, проёмы, плинтус (статично,
 * мемо по масштабу) → размерные линии → подсветка участка плинтуса →
 * выделение/ручки/направляющие → HTML-подписи (плашки стен, размеры проёма)
 * → оверлеи (контекстная панель, масштаб, подсказка, сводка).
 *
 * Рисуем в экранных пикселях (мировые метры × масштаб), сдвиг вида — одним
 * transform у группы: при панорамировании статичные слои не пересчитываются.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { BBox } from "../domain/geometry";
import { computeRoomSkirting } from "../domain/skirtingCalc";
import type { Room } from "../domain/types";
import { getRoomWalls, useActiveRoom, useRoomProduct, useWalls } from "../state/hooks";
import { useAppStore } from "../state/store";
import { useMediaQuery } from "../ui/kit";
import { ContextPanel } from "./ContextPanel";
import { roomBounds, skirtingLines, wallCuts, wallPieces } from "./geom";
import { AngleChip, KeyHandles, layoutWallLabels, OpeningDimChips, SegmentTip, WallLabels } from "./Labels";
import { SelectionLayer, SkirtHoverLayer, WallDims } from "./Layers";
import { Hint, ScaleBar, Summary, ZoomControls, type HintMode } from "./Overlays";
import { notePlanEdit, usePlanUi } from "./planUi";
import { HatchPattern, RoomShapes } from "./Shapes";
import { useInteraction, type InteractionData } from "./useInteraction";
import {
  boxVisible,
  fitView,
  lerpView,
  MAX_SCALE,
  MIN_SCALE,
  zoomAt,
  type Pad,
  type View,
} from "./viewport";
import "./plan.css";

/** Размер элемента (ResizeObserver). */
function useElementSize(ref: RefObject<HTMLElement>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Узкий план: панель — внизу, отступы меньше. */
const NARROW = 560;
/** мс: показ выделения после тапа откладываем — вдруг это первый тап двойного. */
const REVEAL_DELAY = 320;
/** мс: подсказка исчезает плавно (как .pl-hint.is-leaving в plan.css). */
const HINT_FADE = 180;

const isNarrow = (w: number, h: number) => w < NARROW || h < 380;

/** px слева, занятые линейкой масштаба, и справа — кнопками масштаба (как .pl-hint в plan.css). */
const HINT_LEFT = 150;
const HINT_RIGHT = 64;

/**
 * Подсказка одной строкой, где помещается (hintW — её ширина в одну строку
 * по замеру, 0 — ещё не замерена): по центру между линейкой и кнопками
 * масштаба; иначе от левого края (линейка на это время скрыта; на узком
 * плане кнопки масштаба сверху, и низ свободен целиком); иначе столбиком.
 */
function hintMode(w: number, h: number, hintW: number): HintMode {
  if (!hintW) return "stacked";
  const need = hintW + 4;
  if (isNarrow(w, h)) return need + 16 <= w ? "left" : "stacked";
  if (need + HINT_LEFT + HINT_RIGHT <= w) return "center";
  if (need + 12 + HINT_RIGHT <= w) return "left";
  return "stacked";
}

/**
 * Отступы при вписывании: место под плашки размеров и оверлеи (сводка,
 * подсказка, лист выделенного внизу — sheetH px).
 */
function fitPad(w: number, h: number, hint: HintMode | null, coarse: boolean, sheetH: number): Pad {
  // Подсказка столбиком (3 строки) выше однострочной — снизу нужно больше места под неё и плашки.
  const hintPad = hint === "stacked" ? 128 : 100;
  // На тач-экране плашки стен стоят дальше от стены.
  const e = coarse ? 8 : 0;
  const pad = isNarrow(w, h)
    ? { top: 78 + e, right: 52 + e, bottom: hint ? hintPad : 44 + e, left: 44 + e }
    : { top: 84, right: 96, bottom: hint ? hintPad : 72, left: 96 };
  // Плашка нижней стены — над листом, а не под ним.
  if (sheetH > 0) pad.bottom = Math.max(pad.bottom, sheetH + 16 + 44 + e);
  return pad;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Оверлеи в углах плана (сводка, кнопки масштаба) — px от левого верхнего угла плана. */
function overlayBoxes(host: HTMLElement): Box[] {
  const R = host.getBoundingClientRect();
  return [...host.querySelectorAll<HTMLElement>(".pl-summary, .pl-zoom")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x0: r.left - R.left, y0: r.top - R.top, x1: r.right - R.left, y1: r.bottom - R.top };
  });
}

/**
 * Вписывание, при котором плашки стен не уходят под сводку и кнопки
 * масштаба: если уходят — по очереди добавляем отступ с каждой стороны
 * (шагом 12 px) и берём вариант с самым крупным масштабом.
 */
function fitClear(
  r: Room,
  w: number,
  h: number,
  pad: Pad,
  obstacles: readonly Box[],
  along: boolean,
  coarse: boolean,
): View {
  const box = roomBounds(r);
  const base = fitView(box, w, h, pad);
  if (!obstacles.length) return base;
  const walls = getRoomWalls(r);
  const clear = (v: View) => {
    for (const spot of layoutWallLabels(walls, v.s, along, coarse).values()) {
      const x0 = spot.rect.x0 + v.tx;
      const y0 = spot.rect.y0 + v.ty;
      const x1 = spot.rect.x1 + v.tx;
      const y1 = spot.rect.y1 + v.ty;
      if (obstacles.some((o) => o.x0 < x1 + 4 && o.x1 > x0 - 4 && o.y0 < y1 + 4 && o.y1 > y0 - 4)) return false;
    }
    return true;
  };
  if (clear(base)) return base;
  for (let k = 1; k <= 6; k++) {
    let best: View | null = null;
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const v = fitView(box, w, h, { ...pad, [side]: pad[side] + 12 * k });
      if (clear(v) && (!best || v.s > best.s)) best = v;
    }
    if (best) return best;
  }
  return base;
}

/** Сетка: мелкая 10 см (при достаточном масштабе) и крупная 1 м (5 м издалека). */
function Grid({ view, uid }: { view: View; uid: string }) {
  const minor = 0.1 * view.s;
  const majorM = view.s >= 14 ? 1 : 5;
  const major = majorM * view.s;
  const minorOpacity = Math.max(0, Math.min(1, (minor - 7) / 9));
  return (
    <>
      <defs>
        {minorOpacity > 0 ? (
          <pattern id={`${uid}-gm`} width={minor} height={minor} patternUnits="userSpaceOnUse" x={view.tx} y={view.ty}>
            <path className="pl-grid pl-grid--minor" d={`M${minor} 0.5H0.5V${minor}`} />
          </pattern>
        ) : null}
        <pattern id={`${uid}-gM`} width={major} height={major} patternUnits="userSpaceOnUse" x={view.tx} y={view.ty}>
          <path className="pl-grid pl-grid--major" d={`M${major} 0.5H0.5V${major}`} />
        </pattern>
      </defs>
      {minorOpacity > 0 ? (
        <rect width="100%" height="100%" fill={`url(#${uid}-gm)`} style={{ opacity: minorOpacity }} />
      ) : null}
      <rect width="100%" height="100%" fill={`url(#${uid}-gM)`} />
    </>
  );
}

/** Подсказка прячется, когда панель выделения прижата к низу. */
function HintSlot(props: Parameters<typeof Hint>[0]) {
  const sheet = usePlanUi((u) => u.sheetH > 0);
  if (sheet) return null;
  return <Hint {...props} />;
}

/** Подсказку скрыли — ещё HINT_FADE мс она плавно исчезает, потом убираем совсем. */
function useHintGone(hidden: boolean): boolean {
  const [gone, setGone] = useState(hidden);
  useEffect(() => {
    if (!hidden) {
      setGone(false);
      return;
    }
    const t = window.setTimeout(() => setGone(true), HINT_FADE);
    return () => window.clearTimeout(t);
  }, [hidden]);
  return gone;
}

export function PlanView(): JSX.Element {
  const room = useActiveRoom();
  const walls = useWalls();
  const product = useRoomProduct();
  const coarse = useMediaQuery("(pointer: coarse)");
  const uid = `pl${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const size = useElementSize(hostRef);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const [view, setViewState] = useState<View>({ s: 60, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  const hintHidden = usePlanUi((u) => u.hintHidden);
  const hintGone = useHintGone(hintHidden);
  const hintRef = useRef(!hintHidden);
  hintRef.current = !hintHidden;
  // Ширина подсказки в одну строку (замер): в ref — для вписывания в том же кадре.
  const [hintW, setHintW] = useState(0);
  const hintWRef = useRef(0);
  const onHintMeasure = useCallback((px: number) => {
    if (Math.abs(px - hintWRef.current) < 1) return;
    hintWRef.current = px;
    setHintW(px);
  }, []);
  const coarseRef = useRef(coarse);
  coarseRef.current = coarse;
  const [revealTick, setRevealTick] = useState(0);

  // Геометрия комнаты — мемо по ссылке на комнату/стены.
  // Плинтус считаем здесь же (а не отложенной сметой), чтобы линия шла за стеной без задержки.
  const result = useMemo(
    () => (room.skirtingEnabled ? computeRoomSkirting(room, product) : undefined),
    [room, product],
  );
  const piecesByWall = useMemo(
    () => new Map(walls.map((w) => [w.id, wallPieces(w, wallCuts(w, room.openings))])),
    [walls, room.openings],
  );
  const allPieces = useMemo(() => [...piecesByWall.values()].flat(), [piecesByWall]);

  const s = view.s;
  const skirtW = Math.min(6, Math.max(2.5, product.depth * s));
  const skirtOffPx = skirtW / 2 + 1.5;
  const lines = useMemo(
    () => (result ? skirtingLines(result, skirtOffPx / s) : []),
    [result, skirtOffPx, s],
  );
  const dimPerp = (skirtOffPx + skirtW + 18) / s;
  const narrow = isNarrow(size.w, size.h);
  // Плашки стен без наложений (у входящих углов) — общая раскладка для плашек, размерных линий и панели.
  const labels = useMemo(() => layoutWallLabels(walls, s, narrow, coarse), [walls, s, narrow, coarse]);

  /* ------------------------------ Вид ------------------------------ */

  const dataRef = useRef<InteractionData>({ room, walls, lines, view });
  dataRef.current = { room, walls, lines, view: viewRef.current };

  const setView = useCallback((v: View) => {
    viewRef.current = v;
    dataRef.current = { ...dataRef.current, view: v };
    setViewState(v);
  }, []);

  /** Пользователь сам двигал или масштабировал вид (пан, щипок, колесо, ±) — не перевписываем за него. */
  const userMoved = useRef(false);
  const onUserView = useCallback(() => {
    userMoved.current = true;
  }, []);

  const anim = useRef<number | null>(null);
  const stopAnimation = useCallback(() => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    anim.current = null;
  }, []);
  const revealTimer = useRef<number | null>(null);
  const cancelReveal = useCallback(() => {
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    revealTimer.current = null;
  }, []);
  /** Пользователь взялся за план: останавливаем анимацию вида и отложенный показ выделения. */
  const interrupt = useCallback(() => {
    stopAnimation();
    cancelReveal();
  }, [stopAnimation, cancelReveal]);

  const animateTo = useCallback(
    (target: View) => {
      stopAnimation();
      const from = viewRef.current;
      const { w, h } = sizeRef.current;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduce || !w || !h) {
        setView(target);
        return;
      }
      const t0 = performance.now();
      const dur = 280;
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        setView(k >= 1 ? target : lerpView(from, target, e, w, h));
        anim.current = k < 1 ? requestAnimationFrame(step) : null;
      };
      anim.current = requestAnimationFrame(step);
    },
    [setView, stopAnimation],
  );

  /** Вид, в который комната вписана целиком (с местом под плашки и оверлеи). */
  const fitTarget = useCallback((r: Room): View | null => {
    const { w, h } = sizeRef.current;
    const host = hostRef.current;
    if (!w || !h || !host) return null;
    const hint = hintRef.current ? hintMode(w, h, hintWRef.current) : null;
    const pad = fitPad(w, h, hint, coarseRef.current, usePlanUi.getState().sheetH);
    return fitClear(r, w, h, pad, overlayBoxes(host), isNarrow(w, h), coarseRef.current);
  }, []);

  const fitTo = useCallback(
    (r: Room, animated: boolean) => {
      const target = fitTarget(r);
      if (!target) return;
      userMoved.current = false;
      if (animated) animateTo(target);
      else {
        stopAnimation();
        setView(target);
      }
    },
    [fitTarget, animateTo, setView, stopAnimation],
  );

  // Показ выделения: если указатель нажат — после отпускания (и только если это был клик).
  const pendingReveal = useRef<{ dx: number; dy: number } | null>(null);
  // Сдвиг к выделению — не «пользователь двигал вид»: после клавиатуры телефона
  // (изменение размера) и правок из панели план по-прежнему вписывается сам.
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const v = viewRef.current;
      animateTo({ s: v.s, tx: v.tx + dx, ty: v.ty + dy });
    },
    [animateTo],
  );
  // Комната была на экране целиком до начала перетаскивания?
  const fitBeforeEdit = useRef(false);
  // Комната до перетаскивания: изменилась — правка удалась (подсказка новичку больше не нужна).
  const roomBeforeEdit = useRef<Room | null>(null);
  const onEditStart = useCallback(() => {
    const { w, h } = sizeRef.current;
    fitBeforeEdit.current = !!w && !!h && boxVisible(roomBounds(dataRef.current.room), viewRef.current, w, h, -32);
    roomBeforeEdit.current = dataRef.current.room;
  }, []);
  const onGestureEnd = useCallback(
    (tap: boolean, edited: boolean) => {
      const p = pendingReveal.current;
      pendingReveal.current = null;
      if (tap && p) {
        cancelReveal();
        revealTimer.current = window.setTimeout(() => {
          revealTimer.current = null;
          panBy(p.dx, p.dy);
        }, REVEAL_DELAY);
      }
      if (edited) {
        // Стену/угол вытянули за край экрана — после отпускания показываем комнату целиком;
        // иначе — выделенное (вместе с размерами) над листом внизу, как после тапа.
        const { w, h } = sizeRef.current;
        const st = useAppStore.getState();
        const r = st.project.rooms.find((x) => x.id === st.activeRoomId);
        if (r && roomBeforeEdit.current && r !== roomBeforeEdit.current) notePlanEdit();
        roomBeforeEdit.current = null;
        if (fitBeforeEdit.current && r && w && h && !boxVisible(roomBounds(r), viewRef.current, w, h, -32)) {
          fitTo(r, true);
        } else setRevealTick((t) => t + 1);
      }
    },
    [panBy, cancelReveal, fitTo],
  );

  const {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
    onKeyDown,
    onKeyUp,
    isBusy,
    isPressed,
  } = useInteraction({
    svgRef,
    hostRef,
    dataRef,
    setView,
    onUserView,
    stopAnimation: interrupt,
    onEditStart,
    onGestureEnd,
  });

  const onReveal = useCallback(
    (dx: number, dy: number) => {
      if (isPressed()) pendingReveal.current = { dx, dy };
      else panBy(dx, dy);
    },
    [isPressed, panBy],
  );

  // Первый показ и изменение размера: вписываем, пока пользователь сам не двигал вид;
  // иначе сохраняем центр.
  const prevSize = useRef<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (!size.w || !size.h) return;
    const prev = prevSize.current;
    prevSize.current = size;
    if (!prev || !userMoved.current) {
      fitTo(dataRef.current.room, false);
      return;
    }
    const v = viewRef.current;
    setView({ s: v.s, tx: v.tx + (size.w - prev.w) / 2, ty: v.ty + (size.h - prev.h) / 2 });
  }, [size, fitTo, setView]);

  // Смена комнаты/шаблона — вписываем. Правка извне (панель, плашка, отмена),
  // после которой комната перестала помещаться или заметно уменьшилась (а вид
  // пользователь не трогал), — тоже. Свои перетаскивания — нет.
  const prevRoom = useRef<{ id: string; shape: string; bounds: BBox } | null>(null);
  useEffect(() => {
    const bounds = roomBounds(room);
    const prev = prevRoom.current;
    prevRoom.current = { id: room.id, shape: room.shape, bounds };
    const { w, h } = sizeRef.current;
    if (!prev || !w || !h) return;
    if (prev.id !== room.id) {
      fitTo(room, false);
      return;
    }
    if (isBusy()) return;
    if (prev.shape !== room.shape && room.shape !== "custom") {
      fitTo(room, true);
      return;
    }
    // «Видна» — с запасом под плашки размеров у краёв.
    const v = viewRef.current;
    const lost = boxVisible(prev.bounds, v, w, h, -32) && !boxVisible(bounds, v, w, h, -32);
    const sizeChanged =
      Math.abs(bounds.width - prev.bounds.width) > 1e-6 || Math.abs(bounds.height - prev.bounds.height) > 1e-6;
    const fit = !userMoved.current && sizeChanged ? fitTarget(room) : null;
    if (lost || (fit && fit.s > v.s * 1.3)) fitTo(room, true);
  }, [room, fitTo, fitTarget, isBusy]);

  useEffect(() => interrupt, [interrupt]);

  const onFit = useCallback(() => fitTo(dataRef.current.room, true), [fitTo]);
  const onCloseHint = useCallback(() => {
    // Крестик нажали с клавиатуры — фокус остаётся на плане, а не уходит на <body> вместе с подсказкой.
    const host = hostRef.current;
    if (host && document.activeElement?.closest(".pl-hint")) host.focus({ preventScroll: true });
    usePlanUi.getState().hideHint();
  }, []);
  const onZoom = useCallback(
    (factor: number) => {
      const { w, h } = sizeRef.current;
      userMoved.current = true;
      animateTo(zoomAt(viewRef.current, w / 2, h / 2, factor));
    },
    [animateTo],
  );

  /* ------------------------------ Рендер ------------------------------ */

  const ready = size.w > 0 && size.h > 0;
  const hMode = hintMode(size.w, size.h, hintW);
  const translate = `translate(${Math.round(view.tx * 100) / 100} ${Math.round(view.ty * 100) / 100})`;
  const htmlTransform = `translate(${view.tx}px, ${view.ty}px)`;

  return (
    <div
      ref={hostRef}
      className={`pl-root${narrow ? " is-narrow" : ""}${coarse ? " is-coarse" : ""}`}
      // Фокус после клика по плану: стрелки двигают выделенное только отсюда (и с ручек плана).
      tabIndex={-1}
      role="group"
      aria-label="Редактор плана"
      aria-describedby={`${uid}-help`}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      <p id={`${uid}-help`} className="visually-hidden">
        Tab — плашки стен, углы и проёмы; Enter — выбрать и открыть действия; стрелки — сдвинуть на 1 см (с Shift — на
        10 см); Delete — удалить угол или проём; Esc — снять выделение.
      </p>
      <svg
        ref={svgRef}
        className="pl-svg"
        width={size.w || undefined}
        height={size.h || undefined}
        role="img"
        aria-label={`План комнаты «${room.name}»`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <HatchPattern id={`${uid}-hatch`} />
        </defs>
        {ready ? <Grid view={view} uid={uid} /> : null}
        {ready ? (
          <g transform={translate}>
            <RoomShapes
              room={room}
              walls={walls}
              pieces={allPieces}
              s={s}
              lines={lines}
              skirtWidth={skirtW}
              skirtH={product.height}
              hatchId={`${uid}-hatch`}
            />
            <WallDims walls={walls} layout={labels} s={s} />
            <SkirtHoverLayer lines={lines} s={s} width={skirtW} />
            <SelectionLayer
              room={room}
              walls={walls}
              piecesByWall={piecesByWall}
              s={s}
              dimPerp={dimPerp}
              coarse={coarse}
              labels={labels}
            />
          </g>
        ) : null}
      </svg>

      {ready ? (
        <div className="pl-html" style={{ transform: htmlTransform }}>
          <WallLabels room={room} walls={walls} layout={labels} s={s} along={narrow} />
          <KeyHandles room={room} walls={walls} s={s} />
          <OpeningDimChips room={room} walls={walls} s={s} dimPerp={dimPerp} labels={labels} />
          <AngleChip room={room} s={s} />
          <SegmentTip lines={lines} s={s} />
        </div>
      ) : null}

      {ready ? (
        <>
          <Summary room={room} result={result} />
          <ZoomControls onFit={onFit} onZoom={onZoom} canIn={s < MAX_SCALE - 1e-6} canOut={s > MIN_SCALE + 1e-6} />
          {hintGone || (!narrow && hMode !== "left") ? (
            <div className="pl-bottom-left">
              <ScaleBar s={s} />
            </div>
          ) : null}
          {hintGone ? null : (
            <HintSlot coarse={coarse} mode={hMode} leaving={hintHidden} onClose={onCloseHint} onMeasure={onHintMeasure} />
          )}
          <ContextPanel
            hostRef={hostRef}
            room={room}
            walls={walls}
            view={view}
            width={size.w}
            height={size.h}
            docked={narrow}
            coarse={coarse}
            dimPerp={dimPerp}
            skirtH={product.height}
            labels={labels}
            topInset={narrow ? 42 : 48}
            revealTick={revealTick}
            onReveal={onReveal}
          />
        </>
      ) : null}
    </div>
  );
}
