/**
 * Указатель и клавиатура на плане: пан (мышь/один палец), зум колесом и
 * щипком, выделение, перетаскивание стен/вершин/проёмов с привязками,
 * двойной клик/тап по стене — новый угол, стрелки — сдвиг выделенного.
 *
 * Правки идут в store жестом: beginGesture → правки { transient: true } →
 * endGesture (одна запись истории на всё перетаскивание).
 */
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { projectToSegment, sub } from "../domain/geometry";
import type { Room, Vec2, Wall } from "../domain/types";
import { getRoomWalls } from "../state/hooks";
import { useAppStore } from "../state/store";
import { toast } from "../ui/kit";
import { hitSkirting, hitTest, type PlanTarget, type SkirtLine } from "./geom";
import { usePlanUi, type HoverTarget } from "./planUi";
import { toWorld, zoomAt, type View } from "./viewport";

/** Актуальные данные рендера, нужные обработчикам (без пересоздания обработчиков). */
export interface InteractionData {
  room: Room;
  walls: Wall[];
  lines: readonly SkirtLine[];
  view: View;
}

interface Options {
  svgRef: RefObject<SVGSVGElement>;
  hostRef: RefObject<HTMLDivElement>;
  dataRef: RefObject<InteractionData>;
  setView: (v: View) => void;
  /** Пользователь сам двигал/масштабировал вид. */
  onUserView: () => void;
  /** Остановить анимацию вписывания. */
  stopAnimation: () => void;
  /** Начато перетаскивание стены/угла/проёма. */
  onEditStart: () => void;
  /**
   * Указатель отпущен: tap — это было нажатие без перетаскивания,
   * edited — перетаскивали стену/угол/проём (комната могла уйти за край).
   */
  onGestureEnd: (tap: boolean, edited: boolean) => void;
}

type Gesture =
  | { kind: "pending"; id: number; sx: number; sy: number; world: Vec2; target: PlanTarget; touch: boolean; alt: boolean }
  | { kind: "pan"; id: number; sx: number; sy: number; v0: View }
  | { kind: "wall"; id: number; wallId: string; nIn: Vec2; start: Vec2; applied: number }
  | { kind: "point"; id: number; pointId: string; grab: Vec2 }
  | { kind: "opening"; id: number; openingId: string; wallId: string; grab: number; centered: boolean }
  | { kind: "pinch"; a: number; b: number; d0: number; m0: Vec2; v0: View };

/** px: сдвиг, после которого нажатие становится перетаскиванием. */
const DRAG_MOUSE = 3;
const DRAG_TOUCH = 8;
/** мс и px для двойного тапа. */
const DOUBLE_MS = 380;
const DOUBLE_PX = 26;

const snap = (v: number, step: number) => Math.round(v / step) * step;
const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

const activeRoom = (): Room => {
  const s = useAppStore.getState();
  return s.project.rooms.find((r) => r.id === s.activeRoomId) ?? s.project.rooms[0];
};

/** Курсор стены — стрелка поперёк стены (стену тянут по нормали). */
export function wallCursor(n: Vec2): string {
  let a = (Math.atan2(n.y, n.x) * 180) / Math.PI;
  if (a < 0) a += 180;
  if (a < 22.5 || a >= 157.5) return "ew-resize";
  if (a < 67.5) return "nwse-resize";
  if (a < 112.5) return "ns-resize";
  return "nesw-resize";
}

function toHover(t: PlanTarget): HoverTarget {
  if (!t || t.type === "room") return null;
  return { type: t.type, id: t.id };
}

export function useInteraction({
  svgRef,
  hostRef,
  dataRef,
  setView,
  onUserView,
  stopAnimation,
  onEditStart,
  onGestureEnd,
}: Options) {
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef<{ t: number; x: number; y: number; key: string } | null>(null);
  /** Подсветку участка плинтуса ставили мы — нам её и снимать. */
  const ownSegHover = useRef(false);
  const keyGesture = useRef(false);

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const setCursor = (c: string) => {
    const svg = svgRef.current;
    if (svg && svg.style.cursor !== c) svg.style.cursor = c;
  };

  const clearSegHover = () => {
    if (ownSegHover.current) {
      useAppStore.getState().setHoverSegment(null);
      ownSegHover.current = false;
    }
  };

  const tolerances = (touch: boolean, s: number) => ({
    tol: (touch ? 14 : 6) / s,
    pointTol: (touch ? 20 : 10) / s,
  });

  /* ------------------------------ Наведение ------------------------------ */

  const updateHover = (sx: number, sy: number) => {
    const d = dataRef.current!;
    const p = toWorld(d.view, sx, sy);
    const t = hitTest(d.room, d.walls, p, tolerances(false, d.view.s));
    usePlanUi.getState().setHover(toHover(t), t !== null);
    if (!t || t.type === "room") setCursor("default");
    else if (t.type === "point") setCursor("move");
    else if (t.type === "opening") setCursor("grab");
    else {
      const w = d.walls.find((x) => x.id === t.id);
      setCursor(w ? wallCursor(w.normalIn) : "default");
    }
    // Участок плинтуса — подсказка с длиной (кроме наведения на проём/угол).
    const seg = !t || t.type === "wall" || t.type === "room" ? hitSkirting(d.lines, p, 7 / d.view.s) : null;
    const st = useAppStore.getState();
    if (seg) {
      if (st.hoverSegmentId !== seg.id) st.setHoverSegment(seg.id);
      ownSegHover.current = true;
    } else clearSegHover();
  };

  /* ------------------------------ Перетаскивания ------------------------------ */

  const startDrag = (g: Extract<Gesture, { kind: "pending" }>) => {
    const st = useAppStore.getState();
    const d = dataRef.current!;
    const t = g.target;
    const ui = usePlanUi.getState();
    clearSegHover();
    if (t && t.type !== "room") onEditStart();
    if (t && t.type === "point") {
      const pt = d.room.points.find((p) => p.id === t.id);
      if (!pt) return;
      st.beginGesture();
      gesture.current = { kind: "point", id: g.id, pointId: t.id, grab: sub(pt, g.world) };
      ui.setDrag({ kind: "point", pointId: t.id, guideX: null, guideY: null });
      setCursor("move");
    } else if (t && t.type === "opening") {
      const o = d.room.openings.find((x) => x.id === t.id);
      const w = o && d.walls.find((x) => x.id === o.wallId);
      if (!o || !w) return;
      const along = (g.world.x - w.a.x) * w.dir.x + (g.world.y - w.a.y) * w.dir.y;
      st.beginGesture();
      gesture.current = {
        kind: "opening",
        id: g.id,
        openingId: o.id,
        wallId: w.id,
        grab: Math.min(o.width, Math.max(0, along - o.offset)),
        centered: false,
      };
      ui.setDrag({ kind: "opening", openingId: o.id, centered: false });
      setCursor("grabbing");
    } else if (t && t.type === "wall") {
      const w = d.walls.find((x) => x.id === t.id);
      if (!w) return;
      st.beginGesture();
      gesture.current = { kind: "wall", id: g.id, wallId: w.id, nIn: w.normalIn, start: g.world, applied: 0 };
      ui.setDrag({ kind: "wall", wallId: w.id });
      setCursor(wallCursor(w.normalIn));
    } else {
      gesture.current = { kind: "pan", id: g.id, sx: g.sx, sy: g.sy, v0: d.view };
      ui.setDrag({ kind: "pan" });
      setCursor("grabbing");
    }
  };

  const dragTo = (g: Gesture, sx: number, sy: number, alt: boolean) => {
    const d = dataRef.current!;
    const st = useAppStore.getState();
    const p = toWorld(d.view, sx, sy);
    switch (g.kind) {
      case "pan": {
        setView({ s: g.v0.s, tx: g.v0.tx + sx - g.sx, ty: g.v0.ty + sy - g.sy });
        return;
      }
      case "wall": {
        // Перпендикулярно стене, шаг 1 см.
        const total = round(snap((p.x - g.start.x) * g.nIn.x + (p.y - g.start.y) * g.nIn.y, 0.01), 3);
        if (Math.abs(total - g.applied) < 1e-6) return;
        const before = activeRoom();
        st.moveWall(g.wallId, round(total - g.applied, 4), { transient: true });
        if (activeRoom() !== before) g.applied = total;
        return;
      }
      case "point": {
        const raw = { x: p.x + g.grab.x, y: p.y + g.grab.y };
        const room = activeRoom();
        let x = raw.x;
        let y = raw.y;
        let guideX: Vec2 | null = null;
        let guideY: Vec2 | null = null;
        if (!alt) {
          // Выравнивание по x/y других вершин важнее сетки.
          const tol = 8 / d.view.s;
          let bx = tol;
          let by = tol;
          for (const q of room.points) {
            if (q.id === g.pointId) continue;
            const dx = Math.abs(raw.x - q.x);
            const dy = Math.abs(raw.y - q.y);
            if (dx < bx) {
              bx = dx;
              guideX = q;
            }
            if (dy < by) {
              by = dy;
              guideY = q;
            }
          }
          x = guideX ? guideX.x : snap(raw.x, 0.05);
          y = guideY ? guideY.y : snap(raw.y, 0.05);
        }
        const ui = usePlanUi.getState();
        const prev = ui.drag;
        if (
          !prev ||
          prev.kind !== "point" ||
          prev.guideX !== guideX ||
          prev.guideY !== guideY
        ) {
          ui.setDrag({ kind: "point", pointId: g.pointId, guideX, guideY });
        }
        st.moveVertex(g.pointId, { x: round(x), y: round(y) }, { transient: true });
        return;
      }
      case "opening": {
        const room = activeRoom();
        const o = room.openings.find((x) => x.id === g.openingId);
        if (!o) return;
        const walls = getRoomWalls(room);
        // Ближайшая стена; текущей — фора, чтобы проём не «прыгал» у угла.
        const bias = 18 / d.view.s;
        let best: Wall | null = null;
        let bd = Infinity;
        for (const w of walls) {
          if (w.length < o.width + 0.01 && w.id !== g.wallId) continue;
          const dist = projectToSegment(p, w.a, w.b).dist - (w.id === g.wallId ? bias : 0);
          if (dist < bd) {
            bd = dist;
            best = w;
          }
        }
        if (!best) return;
        if (best.id !== g.wallId) {
          g.wallId = best.id;
          g.grab = o.width / 2;
        }
        const w = best;
        const along = (p.x - w.a.x) * w.dir.x + (p.y - w.a.y) * w.dir.y;
        const maxOff = Math.max(0, w.length - o.width);
        let offset = Math.min(maxOff, Math.max(0, snap(along - g.grab, 0.01)));
        // Магнит к центру стены.
        const centerOff = maxOff / 2;
        const centered = Math.abs(offset - centerOff) < 10 / d.view.s;
        if (centered) offset = centerOff;
        if (centered !== g.centered) {
          g.centered = centered;
          usePlanUi.getState().setDrag({ kind: "opening", openingId: o.id, centered });
        }
        offset = round(offset);
        if (o.wallId !== w.id || Math.abs(o.offset - offset) > 1e-6) {
          st.moveOpening(o.id, w.id, offset, { transient: true });
        }
        return;
      }
      default:
        return;
    }
  };

  const endDrag = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "wall" || g.kind === "point" || g.kind === "opening") {
      useAppStore.getState().endGesture();
    }
    if (g.kind === "pan" || g.kind === "pinch") onUserView();
    usePlanUi.getState().setDrag(null);
  };

  /* ------------------------------ Клик / двойной клик ------------------------------ */

  const onTap = (g: Extract<Gesture, { kind: "pending" }>) => {
    const st = useAppStore.getState();
    const t = g.target;
    if (!t || t.type === "room") {
      st.select(null);
      lastTap.current = null;
      return;
    }
    const key = `${t.type}:${t.id}`;
    const now = performance.now();
    const prev = lastTap.current;
    if (prev && prev.key === key && now - prev.t < DOUBLE_MS && Math.hypot(prev.x - g.sx, prev.y - g.sy) < DOUBLE_PX) {
      lastTap.current = null;
      if (t.type === "wall") {
        const before = activeRoom();
        st.splitWall(t.id, round(snap(t.along, 0.01), 3));
        if (activeRoom() === before) toast("Здесь угол не поставить — слишком близко к краю стены", "warning");
      } else if (t.type === "opening") {
        st.setPanelTab("openings");
      }
      return;
    }
    lastTap.current = { t: now, x: g.sx, y: g.sy, key };
  };

  /* ------------------------------ Указатель ------------------------------ */

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const isMouse = e.pointerType === "mouse";
    if (isMouse && e.button !== 0 && e.button !== 1) return;
    const svg = svgRef.current;
    if (!svg) return;
    stopAnimation();
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      // указатель уже отпущен
    }
    const pos = local(e);
    pointers.current.set(e.pointerId, pos);
    const d = dataRef.current!;

    if (pointers.current.size >= 2) {
      // Второй палец — щипок; начатое перетаскивание завершаем.
      const g = gesture.current;
      if (g && g.kind !== "pinch") endDrag();
      const [a, b] = [...pointers.current.keys()];
      const pa = pointers.current.get(a)!;
      const pb = pointers.current.get(b)!;
      gesture.current = {
        kind: "pinch",
        a,
        b,
        d0: Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y)),
        m0: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
        v0: d.view,
      };
      usePlanUi.getState().setDrag({ kind: "pan" });
      return;
    }

    if (isMouse && e.button === 1) {
      e.preventDefault();
      gesture.current = { kind: "pan", id: e.pointerId, sx: pos.x, sy: pos.y, v0: d.view };
      usePlanUi.getState().setDrag({ kind: "pan" });
      setCursor("grabbing");
      return;
    }

    const touch = e.pointerType === "touch";
    const world = toWorld(d.view, pos.x, pos.y);
    const target = hitTest(d.room, d.walls, world, tolerances(touch, d.view.s));
    const st = useAppStore.getState();
    const roomId = d.room.id;
    if (target?.type === "point") st.select({ type: "point", roomId, pointId: target.id });
    else if (target?.type === "opening") st.select({ type: "opening", roomId, openingId: target.id });
    else if (target?.type === "wall") st.select({ type: "wall", roomId, wallId: target.id });
    gesture.current = { kind: "pending", id: e.pointerId, sx: pos.x, sy: pos.y, world, target, touch, alt: e.altKey };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const pos = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, pos);
    const g = gesture.current;
    if (!g) {
      if (e.pointerType !== "touch") updateHover(pos.x, pos.y);
      return;
    }
    if (g.kind === "pinch") {
      const pa = pointers.current.get(g.a);
      const pb = pointers.current.get(g.b);
      if (!pa || !pb) return;
      const dist = Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y));
      const m = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      const z = zoomAt(g.v0, g.m0.x, g.m0.y, dist / g.d0);
      setView({ s: z.s, tx: z.tx + m.x - g.m0.x, ty: z.ty + m.y - g.m0.y });
      return;
    }
    if (g.id !== e.pointerId) return;
    if (g.kind === "pending") {
      const thr = g.touch ? DRAG_TOUCH : DRAG_MOUSE;
      if (Math.hypot(pos.x - g.sx, pos.y - g.sy) < thr) return;
      startDrag(g);
      const ng = gesture.current;
      if (ng && ng.kind !== "pending") dragTo(ng, pos.x, pos.y, e.altKey);
      return;
    }
    dragTo(g, pos.x, pos.y, e.altKey);
  };

  const finish = (e: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
    pointers.current.delete(e.pointerId);
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // нет захвата
    }
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      if (pointers.current.size < 2) {
        endDrag();
        // Оставшийся палец ничего не делает до отпускания.
        gesture.current = null;
        onGestureEnd(false, false);
      }
      return;
    }
    if (g.id !== e.pointerId) return;
    if (g.kind === "pending") {
      gesture.current = null;
      if (!cancelled) onTap(g);
      onGestureEnd(!cancelled, false);
      return;
    }
    endDrag();
    onGestureEnd(false, g.kind === "wall" || g.kind === "point" || g.kind === "opening");
    if (e.pointerType !== "touch") {
      const pos = local(e);
      updateHover(pos.x, pos.y);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => finish(e, false);
  const onPointerCancel = (e: ReactPointerEvent<SVGSVGElement>) => finish(e, true);
  const onPointerLeave = () => {
    if (gesture.current) return;
    usePlanUi.getState().setHover(null, false);
    clearSegHover();
  };

  /* ------------------------------ Колесо ------------------------------ */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      const target = e.target as Element | null;
      // Над панелями и полями — обычная прокрутка.
      if (target && target.closest(".pl-ctx, .pl-hint, input")) return;
      e.preventDefault();
      stopAnimation();
      const d = dataRef.current;
      const svg = svgRef.current;
      if (!d || !svg) return;
      const rect = svg.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dy = e.deltaY * unit;
      // Щипок на тачпаде приходит как wheel с ctrlKey и мелкими шагами.
      const k = e.ctrlKey ? 0.012 : 0.0018;
      const factor = Math.exp(-Math.max(-300, Math.min(300, dy)) * k);
      setView(zoomAt(d.view, e.clientX - rect.left, e.clientY - rect.top, factor));
      onUserView();
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [hostRef, svgRef, dataRef, setView, onUserView, stopAnimation]);

  /* ------------------------------ Клавиатура ------------------------------ */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const k =
        e.key === "ArrowLeft"
          ? { x: -1, y: 0 }
          : e.key === "ArrowRight"
            ? { x: 1, y: 0 }
            : e.key === "ArrowUp"
              ? { x: 0, y: -1 }
              : e.key === "ArrowDown"
                ? { x: 0, y: 1 }
                : null;
      if (!k) return;
      const st = useAppStore.getState();
      const sel = st.selection;
      const room = activeRoom();
      if (!sel || sel.roomId !== room.id) return;
      const step = e.shiftKey ? 0.1 : 0.01;
      const walls = getRoomWalls(room);
      const begin = () => {
        if (!keyGesture.current) {
          st.beginGesture();
          keyGesture.current = true;
        }
      };
      if (sel.type === "opening") {
        const o = room.openings.find((x) => x.id === sel.openingId);
        const w = o && walls.find((x) => x.id === o.wallId);
        if (!o || !w) return;
        const dp = k.x * w.dir.x + k.y * w.dir.y;
        if (Math.abs(dp) < 0.3) return;
        e.preventDefault();
        begin();
        st.moveOpening(o.id, w.id, round(Math.max(0, o.offset + Math.sign(dp) * step)), { transient: true });
      } else if (sel.type === "wall") {
        const w = walls.find((x) => x.id === sel.wallId);
        if (!w) return;
        const dp = k.x * w.normalIn.x + k.y * w.normalIn.y;
        if (Math.abs(dp) < 0.3) return;
        e.preventDefault();
        begin();
        st.moveWall(w.id, Math.sign(dp) * step, { transient: true });
      } else if (sel.type === "point") {
        const pt = room.points.find((p) => p.id === sel.pointId);
        if (!pt) return;
        e.preventDefault();
        begin();
        st.moveVertex(pt.id, { x: round(pt.x + k.x * step), y: round(pt.y + k.y * step) }, { transient: true });
      }
    };
    const onKeyUp = () => {
      if (keyGesture.current) {
        keyGesture.current = false;
        useAppStore.getState().endGesture();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onKeyUp);
      onKeyUp();
    };
  }, []);

  // Размонтирование посреди жеста — закрываем его, чтобы история не «зависла».
  useEffect(
    () => () => {
      const g = gesture.current;
      if (g && (g.kind === "wall" || g.kind === "point" || g.kind === "opening")) {
        useAppStore.getState().endGesture();
      }
      gesture.current = null;
      usePlanUi.setState({ hover: null, inRoom: false, drag: null, editing: null });
      clearSegHover();
    },
    [],
  );

  /** Идёт перетаскивание объекта/вида или сдвиг стрелками. */
  const isBusy = useCallback(() => {
    const g = gesture.current;
    return keyGesture.current || (!!g && g.kind !== "pending");
  }, []);
  /** Указатель нажат (в т.ч. ещё не начато перетаскивание). */
  const isPressed = useCallback(() => gesture.current !== null, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, isBusy, isPressed };
}
