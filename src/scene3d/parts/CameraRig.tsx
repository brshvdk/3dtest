/**
 * Камера: OrbitControls с инерцией, ракурсы «Перспектива», «Сверху»,
 * «От входа» с плавным перелётом, авто-вписывание при смене комнаты,
 * камера не уходит под пол.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { bbox, centroid, getWalls, outerPolygon, pointInPolygon } from "../../domain/geometry";
import type { Room } from "../../domain/types";
import { useView3d, type CameraPreset } from "../sceneState";
import { SLAB } from "./Floor";
import { LABEL_HALF, LABEL_LIFT, labelAnchor } from "./WallLabels";

interface Pose {
  pos: Vector3;
  target: Vector3;
  fov: number;
}

const FOV = 38;
/** Сверху — узкий угол: почти ортогональный вид, как план. */
const FOV_TOP = 20;
const FOV_ENTRY = 56;
const FOV_ENTRY_MAX = 76;
/** «От входа»: угол обзора по горизонтали не меньше, градусы. */
const ENTRY_HFOV = 68;
const DEG = Math.PI / 180;
/** «От входа»: взгляд отклоняется от прямого из двери не больше чем на 45°. */
const ENTRY_TURN = 45 * DEG;

/** Поля кадра в пикселях: снизу — панель управления, сверху и по бокам — подписи стен. */
const MARGIN = { top: 22, bottom: 70, side: 18 };
/** Зазор от чипа подписи до края вида, px. */
const LABEL_EDGE = 6;

interface Viewport {
  width: number;
  height: number;
}

/** Свободная область кадра для точки в NDC (−1…1). */
interface Bounds {
  xl: number;
  xh: number;
  yl: number;
  yh: number;
}

/** Точка, которая должна попасть в свою свободную область кадра. */
interface FitPoint {
  p: Vector3;
  b: Bounds;
}

/**
 * Свободные области: для углов комнаты — с полями MARGIN, для подписей
 * стен — так, чтобы чип целиком был в кадре и не заходил под панель и подсказку.
 */
function frameBounds(vp: Viewport, insetTop: number): { room: Bounds; label: Bounds } {
  const w = Math.max(1, vp.width);
  const h = Math.max(1, vp.height);
  // Подсказка сверху не масштабируется; поля сжимаются на низком виде.
  const inset = Math.min(insetTop, h * 0.3);
  const k = Math.max(0.3, Math.min(1, (0.45 * h - inset) / (MARGIN.top + MARGIN.bottom)));
  const xs = Math.min(0.3, (2 * MARGIN.side) / w);
  const room = {
    xl: -1 + xs,
    xh: 1 - xs,
    yl: -1 + (2 * MARGIN.bottom * k) / h,
    yh: 1 - (2 * (MARGIN.top * k + inset)) / h,
  };
  // Чип шире полей комнаты; на очень узком виде — сколько получится.
  const ls = Math.min(0.6, (2 * (LABEL_HALF.w + LABEL_EDGE)) / w);
  const label = {
    xl: -1 + ls,
    xh: 1 - ls,
    yl: Math.min(0, -1 + (2 * (MARGIN.bottom * k + LABEL_HALF.h)) / h),
    yh: Math.max(0, 1 - (2 * (LABEL_EDGE + LABEL_HALF.h + inset)) / h),
  };
  return { room, label };
}

/**
 * Дистанция и цель, при которых точки pts попадают каждая в свою
 * свободную область и центрированы в ней (с учётом панели снизу).
 */
function fitView(
  pts: FitPoint[],
  target0: Vector3,
  back: Vector3,
  up: Vector3,
  right: Vector3,
  fovDeg: number,
  vp: Viewport,
): { pos: Vector3; target: Vector3 } {
  const w = Math.max(1, vp.width);
  const h = Math.max(1, vp.height);
  const tanV = Math.tan((fovDeg * DEG) / 2);
  const tanH = tanV * (w / h);
  const fwd = back.clone().negate();
  const target = target0.clone();
  const v = new Vector3();
  const lo = (x: number) => Math.min(-0.05, x);
  const hi = (x: number) => Math.max(0.05, x);
  let dist = 1;
  for (let iter = 0; iter < 3; iter++) {
    dist = 0.5;
    for (const { p, b } of pts) {
      v.subVectors(p, target);
      const x = v.dot(right);
      const y = v.dot(up);
      const z = v.dot(fwd);
      const nx = x >= 0 ? x / (hi(b.xh) * tanH) : x / (lo(b.xl) * tanH);
      const ny = y >= 0 ? y / (hi(b.yh) * tanV) : y / (lo(b.yl) * tanV);
      dist = Math.max(dist, Math.max(nx, ny) - z);
    }
    // Центрируем: запас до края своей области слева и справа (снизу и сверху) — поровну.
    let left = Infinity;
    let rightGap = Infinity;
    let bottom = Infinity;
    let top = Infinity;
    for (const { p, b } of pts) {
      v.subVectors(p, target);
      const d = Math.max(0.05, dist + v.dot(fwd));
      const X = v.dot(right) / (d * tanH);
      const Y = v.dot(up) / (d * tanV);
      left = Math.min(left, X - b.xl);
      rightGap = Math.min(rightGap, b.xh - X);
      bottom = Math.min(bottom, Y - b.yl);
      top = Math.min(top, b.yh - Y);
    }
    const dx = (left - rightGap) / 2;
    const dy = (bottom - top) / 2;
    if (Math.abs(dx) < 0.004 && Math.abs(dy) < 0.004) break;
    target.addScaledVector(right, dx * dist * tanH).addScaledVector(up, dy * dist * tanV);
  }
  return { pos: target.clone().addScaledVector(back, dist), target };
}

/**
 * Ракурс для комнаты и размера вида. insetTop — пиксели сверху, занятые
 * оверлеем (подсказкой): комната вписывается ниже. labels — подписи стен
 * показаны: их чипы тоже должны попасть в кадр целиком.
 */
export function computePose(
  room: Room,
  preset: CameraPreset,
  vp: Viewport,
  wallTop = room.height,
  insetTop = 0,
  labels = false,
): Pose {
  const outer = outerPolygon(room);
  const b = bbox(outer);
  const cx = b.minX + b.width / 2;
  const cz = b.minY + b.height / 2;
  const H = room.height;
  const bounds = frameBounds(vp, insetTop);
  // Низ — по «перекрытию» под комнатой: макет в кадре целиком, с боковинами.
  const fit: FitPoint[] = [];
  for (const p of outer) {
    fit.push({ p: new Vector3(p.x, -SLAB, p.y), b: bounds.room }, { p: new Vector3(p.x, wallTop, p.y), b: bounds.room });
  }
  if (labels) {
    // Чип над стеной; над скрытой (кукольный домик) — у пола.
    for (const w of getWalls(room)) {
      const a = labelAnchor(w);
      fit.push(
        { p: new Vector3(a.x, wallTop + LABEL_LIFT, a.z), b: bounds.label },
        { p: new Vector3(a.x, LABEL_LIFT, a.z), b: bounds.label },
      );
    }
  }

  if (preset === "top") {
    // Почти строго сверху; крошечный наклон задаёт «верх» экрана = −z, как у плана.
    const back = new Vector3(0, 1, 0.0006).normalize();
    const up = new Vector3(0, 0, -1);
    const right = new Vector3(1, 0, 0);
    const { pos, target } = fitView(fit, new Vector3(cx, 0, cz), back, up, right, FOV_TOP, vp);
    return { pos, target, fov: FOV_TOP };
  }

  if (preset === "entry") {
    const walls = getWalls(room);
    const pick =
      room.openings.find((o) => o.kind === "door") ??
      room.openings.find((o) => o.kind === "passage") ??
      room.openings.find((o) => o.kind === "balcony");
    let wall = pick ? walls.find((w) => w.id === pick.wallId) : undefined;
    let along: number;
    if (pick && wall) {
      along =
        pick.kind === "balcony"
          ? pick.balconyDoorSide === "left"
            ? pick.offset + Math.min(pick.balconyDoorWidth, pick.width) / 2
            : pick.offset + pick.width - Math.min(pick.balconyDoorWidth, pick.width) / 2
          : pick.offset + pick.width / 2;
    } else {
      wall = walls.reduce((m, w) => (w.length > m.length ? w : m), walls[0]);
      along = wall.length / 2;
    }
    const P = { x: wall.a.x + wall.dir.x * along, y: wall.a.y + wall.dir.y * along };
    // Стоим на пороге: так в кадре вся комната. Полотно двери, пока камера
    // в комнате, закрыто (models/Door) — за спиной и не заслоняет вид.
    let back = 0.4;
    let cam = { x: P.x + wall.normalIn.x * back, y: P.y + wall.normalIn.y * back };
    while (back > 0.15 && !pointInPolygon(cam, room.points)) {
      back -= 0.1;
      cam = { x: P.x + wall.normalIn.x * back, y: P.y + wall.normalIn.y * back };
    }
    const eye = Math.min(1.6, H - 0.3);
    // Смотрим в сторону центра комнаты, но не круче ENTRY_TURN от взгляда прямо
    // из двери (дверь у торца: иначе в кадре одна боковая стена);
    // цель — у дальней стены ниже глаз, чтобы плинтус по периметру был виден.
    const n = wall.normalIn;
    const c = centroid(room.points);
    let dx = c.x - cam.x;
    let dz = c.y - cam.y;
    const l = Math.hypot(dx, dz);
    if (l < 0.8) {
      dx = n.x;
      dz = n.y;
    } else {
      dx /= l;
      dz /= l;
      if (dx * n.x + dz * n.y < Math.cos(ENTRY_TURN)) {
        const a = Math.atan2(n.y, n.x) + (n.x * dz - n.y * dx >= 0 ? 1 : -1) * ENTRY_TURN;
        dx = Math.cos(a);
        dz = Math.sin(a);
      }
    }
    let reach = 0.5;
    while (reach < 30 && pointInPolygon({ x: cam.x + dx * (reach + 0.25), y: cam.y + dz * (reach + 0.25) }, room.points)) {
      reach += 0.25;
    }
    const far = Math.max(1.5, reach * 0.85);
    const target = new Vector3(cam.x + dx * far, Math.min(1.0, H * 0.4), cam.y + dz * far);
    // На узком (портретном) виде угол по горизонтали иначе слишком мал — «смотрим в щель».
    const aspect = Math.max(0.3, vp.width / Math.max(1, vp.height));
    const hFov = (2 * Math.atan(Math.tan((ENTRY_HFOV * DEG) / 2) / aspect)) / DEG;
    const fov = Math.min(FOV_ENTRY_MAX, Math.max(FOV_ENTRY, hFov));
    return { pos: new Vector3(cam.x, eye, cam.y), target, fov };
  }

  // Перспектива: сверху-спереди-справа, комната целиком в кадре.
  const az = 32 * DEG;
  const el = 40 * DEG;
  const back = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)); // от цели к камере
  const right = new Vector3().crossVectors(back.clone().negate(), new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, back.clone().negate()).normalize();
  const { pos, target } = fitView(fit, new Vector3(cx, wallTop * 0.22, cz), back, up, right, FOV, vp);
  return { pos, target, fov: FOV };
}

/** Габарит комнаты для решения «пора ли переснять ракурс». */
interface Frame {
  id: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  height: number;
}

function frameOf(room: Room): Frame {
  const b = bbox(room.points);
  return { id: room.id, minX: b.minX, minY: b.minY, maxX: b.minX + b.width, maxY: b.minY + b.height, height: room.height };
}

/** Комната заметно сдвинулась/изменилась относительно кадра (доля диагонали). */
function frameChanged(a: Frame, b: Frame): boolean {
  const ext = Math.max(0.5, Math.hypot(a.maxX - a.minX, a.maxY - a.minY));
  const d = Math.max(
    Math.abs(a.minX - b.minX),
    Math.abs(a.minY - b.minY),
    Math.abs(a.maxX - b.maxX),
    Math.abs(a.maxY - b.maxY),
    Math.abs(a.height - b.height) * 0.6,
  );
  return d / ext > 0.04;
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Flight {
  from: Pose;
  to: Pose;
  t0: number;
  dur: number;
}

/** Пауза после последней правки размеров, после которой камера переснимает ракурс, мс. */
const REFIT_DELAY = 420;

/** wallTop — высота стен в кадре (в режиме «Низкие» комнату можно показать крупнее). */
export function CameraRig({ room, wallTop }: { room: Room; wallTop: number }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const request = useView3d((s) => s.request);
  const insetTop = useView3d((s) => s.insetTop);
  const labels = useView3d((s) => s.labels);
  const flight = useRef<Flight | null>(null);
  const roomRef = useRef(room);
  roomRef.current = room;
  const topRef = useRef(wallTop);
  topRef.current = wallTop;
  const insetRef = useRef(insetTop);
  insetRef.current = insetTop;
  const aspect = size.width / Math.max(1, size.height);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  /** Комната в момент последнего вписывания. */
  const fitted = useRef<Frame | null>(null);
  /** Положение камеры в начале жеста: жестом считается только реальное движение. */
  const gesture = useRef<{ pos: Vector3; target: Vector3 } | null>(null);
  const mountedAt = useRef(performance.now());

  const apply = (pose: Pose) => {
    camera.position.copy(pose.pos);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
    const c = controls.current;
    if (c) {
      c.target.copy(pose.target);
      c.update();
    } else {
      camera.lookAt(pose.target);
    }
  };

  const fly = (preset: CameraPreset, instant: boolean) => {
    const r = roomRef.current;
    const to = computePose(r, preset, sizeRef.current, topRef.current, insetRef.current, useView3d.getState().labels);
    fitted.current = frameOf(r);
    gesture.current = null;
    const c = controls.current;
    // Сразу после появления вида — без анимации (подсказка измерилась чуть позже кадра);
    // и без перелётов, если в системе попросили меньше движения.
    if (instant || !c || performance.now() - mountedAt.current < 700 || reducedMotion()) {
      flight.current = null;
      apply(to);
      invalidate();
      return;
    }
    flight.current = {
      from: { pos: camera.position.clone(), target: c.target.clone(), fov: camera.fov },
      to,
      t0: performance.now(),
      dur: 750,
    };
    invalidate();
  };

  /** Переснять текущий ракурс, если пользователь не уводил камеру сам. */
  const refit = (instant = false) => {
    const preset = useView3d.getState().activePreset;
    if (preset) fly(preset, instant);
  };

  // Запросы ракурса от кнопок.
  const lastSeq = useRef(-1);
  useLayoutEffect(() => {
    if (request.seq === lastSeq.current) return;
    const first = lastSeq.current < 0;
    lastSeq.current = request.seq;
    fly(request.preset, request.instant || first);
  }, [request]);

  // Другая комната — вписываем сразу (ракурс сохраняем); применён шаблон формы —
  // плавно показываем новую форму целиком (сверху — так и остаёмся сверху).
  const last = useRef({ id: room.id, shape: room.shape });
  useEffect(() => {
    const prev = last.current;
    last.current = { id: room.id, shape: room.shape };
    const st = useView3d.getState();
    if (prev.id !== room.id) st.goTo(st.activePreset ?? "persp", true);
    else if (prev.shape !== room.shape && room.shape !== "custom") st.goTo(st.activePreset === "top" ? "top" : "persp");
  }, [room.id, room.shape]);

  // Размеры поменялись (ввели длину, дотянули стену на плане) — когда правки
  // утихнут, плавно переснимаем ракурс. Во время перетаскивания камера не дёргается.
  const frame = frameOf(room);
  const frameKey = `${frame.id}|${frame.minX.toFixed(3)}|${frame.minY.toFixed(3)}|${frame.maxX.toFixed(3)}|${frame.maxY.toFixed(3)}|${frame.height}`;
  useEffect(() => {
    const t = window.setTimeout(() => {
      const f = fitted.current;
      const now = frameOf(roomRef.current);
      if (f && f.id === now.id && frameChanged(f, now)) refit();
    }, REFIT_DELAY);
    return () => window.clearTimeout(t);
  }, [frameKey]);

  // Высота стен в кадре (режим «Низкие»), место под подсказкой или подписи стен — переснять.
  const firstTop = useRef(true);
  useEffect(() => {
    if (firstTop.current) {
      firstTop.current = false;
      return;
    }
    refit();
  }, [wallTop, insetTop, labels]);

  // Размер окна поменялся сильно (поворот телефона, режим «Оба») — переснять текущий ракурс.
  const lastAspect = useRef(aspect);
  useEffect(() => {
    const prev = lastAspect.current;
    lastAspect.current = aspect;
    if (Math.abs(Math.log(aspect / prev)) > 0.2) refit(true);
  }, [aspect]);

  useFrame(() => {
    const f = flight.current;
    const c = controls.current;
    if (!f || !c) return;
    const k = Math.min(1, (performance.now() - f.t0) / f.dur);
    const e = ease(k);
    camera.position.lerpVectors(f.from.pos, f.to.pos, e);
    c.target.lerpVectors(f.from.target, f.to.target, e);
    camera.fov = f.from.fov + (f.to.fov - f.from.fov) * e;
    camera.updateProjectionMatrix();
    if (k >= 1) flight.current = null;
    invalidate();
  });

  const onStart = () => {
    const c = controls.current;
    // Пользователь перехватил камеру посреди перелёта — останавливаемся там, где есть.
    flight.current = null;
    gesture.current = c ? { pos: camera.position.clone(), target: c.target.clone() } : null;
  };

  const onEnd = () => {
    gesture.current = null;
  };

  const onChange = () => {
    const c = controls.current;
    if (!c) return;
    // Не даём камере и цели уйти под пол.
    const H = roomRef.current.height;
    if (c.target.y < 0) c.target.y = 0;
    if (c.target.y > H) c.target.y = H;
    if (camera.position.y < 0.12) camera.position.y = 0.12;
    // Простой клик/касание — не поворот: ракурс и подсказка остаются.
    const g = gesture.current;
    if (g && (camera.position.distanceToSquared(g.pos) > 1e-6 || c.target.distanceToSquared(g.target) > 1e-6)) {
      gesture.current = null;
      const st = useView3d.getState();
      st.setActivePreset(null);
      st.dismissHint();
    }
  };

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      // Инерция вращения — движение, которого пользователь просил избегать.
      enableDamping={!reducedMotion()}
      dampingFactor={0.12}
      rotateSpeed={0.7}
      zoomSpeed={0.9}
      minDistance={0.4}
      maxDistance={60}
      maxPolarAngle={Math.PI / 2 - 0.04}
      onStart={onStart}
      onEnd={onEnd}
      onChange={onChange}
    />
  );
}
