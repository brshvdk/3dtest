/**
 * Подписи стен (A · 4,50 м) — HTML-чипы над стенами. Над скрытой стеной
 * чип опускается к полу, у дальних (за комнатой) — приглушается.
 * Чипы, которые на экране налезают друг на друга (короткие соседние
 * стены), разводятся по вертикали; у края вида — прижимаются внутрь.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Vector3, type Group } from "three";
import { formatLength } from "../../domain/units";
import { pointInPolygon } from "../../domain/geometry";
import type { Vec2, Wall } from "../../domain/types";
import { useAppStore } from "../../state/store";
import { useScene } from "../context";

/** Высота чипа над верхом стены (и над полом у скрытой стены), м. */
export const LABEL_LIFT = 0.16;
/** Полуразмер чипа с запасом, px: кадр ракурса вписывается вместе с подписями. */
export const LABEL_HALF = { w: 42, h: 11 } as const;

/** Точка подписи на плане: середина стены по внешней грани. */
export function labelAnchor(wall: Wall): { x: number; z: number } {
  return {
    x: (wall.a.x + wall.b.x) / 2 + wall.normalOut.x * (wall.thickness / 2),
    z: (wall.a.y + wall.b.y) / 2 + wall.normalOut.y * (wall.thickness / 2),
  };
}

/** Чип подписи для разводки наложений (заполняется подписью, читается в кадре). */
interface Slot {
  group: Group | null;
  chip: HTMLDivElement | null;
  /** Размер чипа, px (0 — ещё не измерен или скрыт). */
  w: number;
  h: number;
  /** Важнее при наложении: выделенная, затем длинная. */
  selected: boolean;
  length: number;
  /** Внешняя нормаль стены на плане — куда отодвигать чип. */
  nx: number;
  nz: number;
  /** Применённый сдвиг, px. */
  dx: number;
  dy: number;
}

/**
 * Чипы подписей и их размеры. Размер приходит из ResizeObserver — после
 * раскладки браузера: читать offsetWidth в кадре значило бы принудительно
 * раскладывать всю страницу (при перетаскивании стены — на каждом шаге).
 */
class Chips {
  slots = new Map<string, Slot>();
  private byEl = new WeakMap<Element, Slot>();
  private ro: ResizeObserver | null;

  constructor(onResize: () => void) {
    this.ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            for (const e of entries) {
              const s = this.byEl.get(e.target);
              const box = e.borderBoxSize?.[0];
              if (!s) continue;
              s.w = box ? box.inlineSize : (e.target as HTMLElement).offsetWidth;
              s.h = box ? box.blockSize : (e.target as HTMLElement).offsetHeight;
            }
            onResize();
          });
  }

  /** Без ResizeObserver размер меряем сами (старые браузеры). */
  get measured(): boolean {
    return !!this.ro;
  }

  attach(el: HTMLDivElement, slot: Slot): void {
    this.byEl.set(el, slot);
    this.ro?.observe(el);
  }

  detach(el: HTMLDivElement): void {
    this.byEl.delete(el);
    this.ro?.unobserve(el);
  }

  dispose(): void {
    this.ro?.disconnect();
  }
}

/** Контур и высота комнаты: «камера внутри» (вид «От входа»). */
interface Shape {
  points: Vec2[];
  ceiling: number;
}

function sameLabel(
  p: { wall: Wall; top: number; selected: boolean },
  n: { wall: Wall; top: number; selected: boolean },
): boolean {
  const a = p.wall;
  const b = n.wall;
  return (
    p.top === n.top &&
    p.selected === n.selected &&
    a.id === b.id &&
    a.label === b.label &&
    a.length === b.length &&
    a.thickness === b.thickness &&
    a.a.x === b.a.x &&
    a.a.y === b.a.y &&
    a.b.x === b.b.x &&
    a.b.y === b.b.y
  );
}

const Label = memo(function Label({
  wall,
  top,
  selected,
  shape,
  chips,
}: {
  wall: Wall;
  top: number;
  selected: boolean;
  /** Ссылка, а не значение: перетаскивание чужой стены не перерисовывает подпись. */
  shape: MutableRefObject<Shape>;
  chips: Chips;
}) {
  const { registry } = useScene();
  const invalidate = useThree((s) => s.invalidate);
  const slot = useMemo<Slot>(
    () => ({ group: null, chip: null, w: 0, h: 0, selected: false, length: 0, nx: 0, nz: 0, dx: 0, dy: 0 }),
    [],
  );
  // Html рендерит содержимое в отдельный корень — элемент появляется позже кадра.
  const setChip = useCallback(
    (el: HTMLDivElement | null) => {
      if (slot.chip) chips.detach(slot.chip);
      slot.chip = el;
      slot.w = slot.h = 0;
      slot.dx = slot.dy = 0;
      if (el) {
        chips.attach(el, slot);
        invalidate();
      }
    },
    [slot, chips, invalidate],
  );
  const setGroup = useCallback(
    (g: Group | null) => {
      slot.group = g;
    },
    [slot],
  );

  useLayoutEffect(() => {
    const { slots } = chips;
    slots.set(wall.id, slot);
    return () => {
      if (slots.get(wall.id) === slot) slots.delete(wall.id);
    };
  }, [chips, wall.id, slot]);

  useLayoutEffect(() => {
    slot.selected = selected;
    slot.length = wall.length;
    slot.nx = wall.normalOut.x;
    slot.nz = wall.normalOut.y;
    // Текст сменился — без ResizeObserver перемерим в кадре.
    if (!chips.measured) slot.w = 0;
    invalidate();
  }, [slot, chips, selected, wall.length, wall.label, wall.normalOut.x, wall.normalOut.y, invalidate]);

  const { x: mx, z: mz } = labelAnchor(wall);

  useFrame(({ camera }) => {
    const g = slot.group;
    if (!g) return;
    const hidden = registry.hidden.has(wall.id);
    const y = hidden ? LABEL_LIFT : top + LABEL_LIFT;
    // Html обновляет позицию в своём useFrame (он раньше нашего) — нужен ещё кадр.
    if (g.position.y !== y) {
      g.position.y = y;
      invalidate();
    }
    const facing = (camera.position.x - mx) * wall.normalOut.x + (camera.position.z - mz) * wall.normalOut.y;
    // Дальняя стена: камера с внутренней стороны и смотрит не сверху.
    const far = facing < -0.2 && !hidden && camera.position.y - y < -facing * 0.75;
    // Камера внутри комнаты (вид «От входа») — подписи над потолком не нужны.
    const p = camera.position;
    const { points, ceiling } = shape.current;
    const inside = p.y < ceiling && pointInPolygon({ x: p.x, y: p.z }, points);
    const el = slot.chip;
    if (el) {
      if (el.classList.contains("is-far") !== far) el.classList.toggle("is-far", far);
      if (el.classList.contains("is-off") !== inside) el.classList.toggle("is-off", inside);
    }
  });

  return (
    <group ref={setGroup} position={[mx, top + LABEL_LIFT, mz]}>
      <Html
        ref={setChip}
        center
        zIndexRange={[4, 0]}
        pointerEvents="none"
        className={`s3d-wall-label${selected ? " is-selected" : ""}`}
      >
        <b>{wall.label}</b>
        <span className="s3d-wall-label__dot" aria-hidden>
          ·
        </span>
        <span>{formatLength(wall.length)}</span>
      </Html>
    </group>
  );
}, sameLabel);

/* --------------------- Разводка наложившихся чипов --------------------- */

/** Зазор между чипами и от края вида, px. */
const GAP = 3;
const EDGE = 4;

interface Item {
  s: Slot;
  x: number;
  y: number;
  /** Наружу от комнаты на экране — вниз. */
  down: boolean;
  far: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlap(placed: Rect[], x: number, y: number, w: number, h: number): number {
  let sum = 0;
  for (const r of placed) {
    const ox = (w + r.w) / 2 + GAP - Math.abs(x - r.x);
    const oy = (h + r.h) / 2 + GAP - Math.abs(y - r.y);
    if (ox > 0 && oy > 0) sum += ox * oy;
  }
  return sum;
}

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

/**
 * Чипы по важности ставятся на свои места; занятое место — сдвиг на строку
 * наружу от комнаты (потом внутрь, потом на две). Чип, чья точка в кадре,
 * не вылезает за край вида.
 */
function useLabelLayout(chips: Chips) {
  const v = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const W = size.width;
    const H = size.height;
    camera.updateMatrixWorld();
    const items: Item[] = [];
    for (const s of chips.slots.values()) {
      const el = s.chip;
      const g = s.group;
      if (!el || !g || el.classList.contains("is-off")) continue;
      v.copy(g.position).project(camera);
      if (v.z < -1 || v.z > 1) continue;
      const x = ((v.x + 1) / 2) * W;
      const y = ((1 - v.y) / 2) * H;
      if (!s.w && !chips.measured) {
        s.w = el.offsetWidth;
        s.h = el.offsetHeight;
      }
      if (!s.w) continue;
      v.set(g.position.x + s.nx * 0.5, g.position.y, g.position.z + s.nz * 0.5).project(camera);
      const down = ((1 - v.y) / 2) * H >= y;
      items.push({ s, x, y, down, far: el.classList.contains("is-far") });
    }
    items.sort(
      (a, b) =>
        Number(b.s.selected) - Number(a.s.selected) || Number(a.far) - Number(b.far) || b.s.length - a.s.length,
    );
    const placed: Rect[] = [];
    for (const it of items) {
      const { w, h } = it.s;
      const step = (it.down ? 1 : -1) * (h + GAP);
      const inX = it.x >= 0 && it.x <= W;
      const inY = it.y >= 0 && it.y <= H;
      let bx = it.x;
      let by = it.y;
      let best = Infinity;
      for (const k of [0, 1, -1, 2, -2]) {
        const x = inX ? clamp(it.x, w / 2 + EDGE, W - w / 2 - EDGE) : it.x;
        const y = inY ? clamp(it.y + k * step, h / 2 + EDGE, H - h / 2 - EDGE) : it.y + k * step;
        const ov = overlap(placed, x, y, w, h);
        if (ov < best) {
          best = ov;
          bx = x;
          by = y;
          if (ov === 0) break;
        }
      }
      placed.push({ x: bx, y: by, w, h });
      const dx = Math.round(bx - it.x);
      const dy = Math.round(by - it.y);
      if (dx !== it.s.dx || dy !== it.s.dy) {
        it.s.dx = dx;
        it.s.dy = dy;
        it.s.chip!.style.translate = dx || dy ? `${dx}px ${dy}px` : "";
      }
    }
  });
}

export function WallLabels({
  walls,
  roomId,
  top,
  points,
  ceiling,
}: {
  walls: Wall[];
  roomId: string;
  top: number;
  points: Vec2[];
  ceiling: number;
}) {
  const selectedWall = useAppStore((s) =>
    s.selection?.type === "wall" && s.selection.roomId === roomId ? s.selection.wallId : null,
  );
  const invalidate = useThree((s) => s.invalidate);
  const shape = useRef<Shape>({ points, ceiling });
  shape.current = { points, ceiling };
  const chips = useMemo(() => new Chips(invalidate), [invalidate]);
  useEffect(() => () => chips.dispose(), [chips]);
  useLabelLayout(chips);
  return (
    <group>
      {walls.map((w) => (
        <Label key={w.id} wall={w} top={top} selected={selectedWall === w.id} shape={shape} chips={chips} />
      ))}
    </group>
  );
}
