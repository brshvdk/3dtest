/**
 * HTML-подписи на плане (в слое, сдвинутом вместе с видом): плашки стен
 * «A · 4,50 м» с вводом длины по клику, расстояния выделенного проёма до
 * углов (см), подсказка участка плинтуса, угол выделенной вершины,
 * невидимые ручки углов и проёмов для клавиатуры.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { cornerAt, normalize } from "../domain/geometry";
import { describeOpening } from "../domain/openings";
import { MAX_ROOM_EXTENT, MIN_WALL } from "../domain/roomEdit";
import type { Opening, Room, Wall } from "../domain/types";
import { formatLength, formatNumber, fromMeters, parseLength, roundTo, type LengthUnit } from "../domain/units";
import { useAppStore } from "../state/store";
import { toast } from "../ui/kit";
import { onWall, uprightAngle, type SkirtLine } from "./geom";
import { keepFocusInPlan, notePlanEdit, selectOnPlan, usePlanUi } from "./planUi";

const activeRoom = (): Room => {
  const s = useAppStore.getState();
  return s.project.rooms.find((r) => r.id === s.activeRoomId) ?? s.project.rooms[0];
};

/* ------------------------------ Ввод ------------------------------ */

function InlineInput({
  value,
  unit,
  onCommit,
  onClose,
  label,
  chipKey,
}: {
  value: number;
  unit: LengthUnit;
  onCommit: (m: number) => void;
  onClose: () => void;
  label: string;
  /** data-chip плашки, на которую вернуть фокус после Enter/Esc. */
  chipKey: string;
}) {
  const digits = unit === "m" ? 2 : 0;
  const initial = formatNumber(roundTo(fromMeters(value, unit), digits), digits, { trim: unit !== "m" }).replace(/\s/g, "");
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [nudge, setNudge] = useState<{ x: number; y: number } | null>(null);
  const done = useRef(false);
  /** Закрыли с клавиатуры — фокус обратно на плашку (а не на <body>). */
  const refocus = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
    const root = el.closest<HTMLElement>(".pl-root");
    return () => {
      if (!refocus.current || !root) return;
      // Плашка уже на месте поля (тот же коммит); плашки нет (проём упёрся в угол) — на план.
      const chip = root.querySelector<HTMLElement>(`[data-chip="${chipKey}"]`);
      (chip ?? root).focus({ preventScroll: true });
    };
  }, [chipKey]);

  // Поле у края плана (плашка у края экрана, повёрнутая плашка) — целиком в видимую область.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    const root = el?.closest(".pl-root");
    if (!el || !root) return;
    const r = el.getBoundingClientRect();
    const R = root.getBoundingClientRect();
    const m = 8;
    const x = r.left < R.left + m ? R.left + m - r.left : r.right > R.right - m ? R.right - m - r.right : 0;
    const y = r.top < R.top + m ? R.top + m - r.top : r.bottom > R.bottom - m ? R.bottom - m - r.bottom : 0;
    if (x || y) setNudge({ x: Math.round(x), y: Math.round(y) });
  }, []);

  const commit = (fromBlur: boolean) => {
    if (done.current) return;
    const v = parseLength(draft, unit);
    if (v === null) {
      if (fromBlur) {
        done.current = true;
        onClose();
        return;
      }
      setError(true);
      window.setTimeout(() => setError(false), 600);
      return;
    }
    done.current = true;
    onClose();
    if (Math.abs(v - value) > 1e-6) onCommit(v);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    // preventDefault: фокус уходит на плашку ещё в этом keydown — без него её
    // «нажал» бы тот же Enter, и поле открылось бы снова.
    if (e.key === "Enter" || e.key === "Escape") e.preventDefault();
    if (e.key === "Enter") {
      refocus.current = true;
      commit(false);
      if (!done.current) refocus.current = false;
    } else if (e.key === "Escape") {
      refocus.current = true;
      done.current = true;
      onClose();
    }
  };

  return (
    <span
      ref={wrapRef}
      className={`pl-chip pl-chip--edit${error ? " is-error" : ""}`}
      style={nudge ? { translate: `${nudge.x}px ${nudge.y}px` } : undefined}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        className="pl-chip__input"
        value={draft}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        style={{ width: `${Math.max(3, draft.length) + 0.5}ch` }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(true)}
      />
      <span className="pl-chip__unit">{unit === "m" ? "м" : unit === "cm" ? "см" : "мм"}</span>
    </span>
  );
}

/* ------------------------------ Стены ------------------------------ */

/** Оценка ширины плашки, px (для отступа от стены). */
const chipWidth = (text: string) => text.length * 6.5 + 20;
const CHIP_H = 24;
/** Высота плашки для раскладки (на тач-экранах плашки выше) и зазор между плашками, px. */
const LAYOUT_H = 28;
const LAYOUT_GAP = 4;

/**
 * Расстояние центра плашки от внешней грани стены наружу, px.
 * along — плашка повёрнута вдоль стены (узкий экран), иначе — горизонтальна.
 */
export function labelOffsetPx(w: Wall, text: string, along: boolean, gap = 8): number {
  if (along) return gap + CHIP_H / 2;
  return gap + Math.abs(w.normalOut.x) * (chipWidth(text) / 2) + Math.abs(w.normalOut.y) * (CHIP_H / 2);
}

export function wallLabelText(w: Wall, s: number, along: boolean): { text: string; compact: boolean } {
  const full = `${w.label} · ${formatLength(w.length)}`;
  // Сколько плашка занимает вдоль стены.
  const ext = along ? chipWidth(full) : Math.abs(w.dir.x) * chipWidth(full) + Math.abs(w.dir.y) * CHIP_H;
  const compact = w.length * s < ext + 14;
  return { text: compact ? w.label : full, compact };
}

/** Где стоит плашка стены: текст, отступ наружу и сдвиг вдоль стены (px). */
export interface WallLabelSpot {
  text: string;
  compact: boolean;
  /** px от внешней грани стены до центра плашки (на этом же уровне — размерная линия). */
  offPx: number;
  /** px сдвига плашки вдоль стены от её середины (разведение с соседними плашками). */
  shiftPx: number;
  /** Габарит плашки в px (мировые × s, без сдвига вида). */
  rect: Rect;
}
export type WallLabelLayout = ReadonlyMap<string, WallLabelSpot>;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Экранный габарит плашки (px, без сдвига вида). */
function chipRect(w: Wall, s: number, along: boolean, text: string, offPx: number, shiftPx: number): Rect {
  const c = onWall(w, w.length / 2 + shiftPx / s, -w.thickness - offPx / s);
  const cw = chipWidth(text);
  let hx = cw / 2;
  let hy = LAYOUT_H / 2;
  if (along) {
    const a = (uprightAngle(w.dir) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(a));
    const sin = Math.abs(Math.sin(a));
    hx = (cos * cw + sin * LAYOUT_H) / 2;
    hy = (sin * cw + cos * LAYOUT_H) / 2;
  }
  return { x0: c.x * s - hx, y0: c.y * s - hy, x1: c.x * s + hx, y1: c.y * s + hy };
}

const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x0 < b.x1 + LAYOUT_GAP && b.x0 < a.x1 + LAYOUT_GAP && a.y0 < b.y1 + LAYOUT_GAP && b.y0 < a.y1 + LAYOUT_GAP;

/**
 * Раскладка плашек стен без наложений. Длинные стены ставят плашку
 * посередине; плашка короткой стены, наехавшая на уже поставленную
 * (у входящих углов Г-, П-, Т-образных комнат), сдвигается вдоль своей
 * стены, сворачивается до буквы (полный текст — в подсказке) и только
 * потом отодвигается на ряд дальше от стены. Если места нет совсем —
 * положение с наименьшим наложением.
 */
export function layoutWallLabels(
  walls: readonly Wall[],
  s: number,
  along: boolean,
  /** Палец: плашку дальше от стены — иначе тап по краю стены попадает в плашку. */
  coarse = false,
): Map<string, WallLabelSpot> {
  const out = new Map<string, WallLabelSpot>();
  const placed: Rect[] = [];
  const order = [...walls].sort((p, q) => q.length - p.length);
  const STEP = 6;
  const overlapArea = (r: Rect) => {
    let sum = 0;
    for (const p of placed) {
      const w = Math.min(r.x1, p.x1) + LAYOUT_GAP - Math.max(r.x0, p.x0);
      const h = Math.min(r.y1, p.y1) + LAYOUT_GAP - Math.max(r.y0, p.y0);
      if (w > 0 && h > 0) sum += w * h;
    }
    return sum;
  };
  for (const w of order) {
    const auto = wallLabelText(w, s, along);
    const short = { text: w.label, compact: true };
    const variants: Array<{ text: string; compact: boolean; level: number }> = [{ ...auto, level: 0 }];
    if (!auto.compact) variants.push({ ...short, level: 0 });
    variants.push({ ...auto, level: 1 });
    if (!auto.compact) variants.push({ ...short, level: 1 });
    variants.push({ ...short, level: 2 });
    const maxShift = (w.length * s) / 2;
    let found: (WallLabelSpot & { area: number }) | null = null;
    let best: (WallLabelSpot & { area: number }) | null = null;
    for (const v of variants) {
      const offPx = labelOffsetPx(w, v.text, along, coarse ? 16 : 8) + v.level * (LAYOUT_H + 6);
      const r0 = chipRect(w, s, along, v.text, offPx, 0);
      const hit = placed.find((p) => rectsOverlap(r0, p));
      // Сначала — в сторону от мешающей плашки.
      let sign = 1;
      if (hit) {
        const dx = (r0.x0 + r0.x1 - hit.x0 - hit.x1) / 2;
        const dy = (r0.y0 + r0.y1 - hit.y0 - hit.y1) / 2;
        sign = dx * w.dir.x + dy * w.dir.y >= 0 ? 1 : -1;
      }
      for (let k = 0; k * STEP <= maxShift && !found; k++) {
        for (const sg of k === 0 ? [0] : [sign, -sign]) {
          const shiftPx = sg * k * STEP;
          const rect = k === 0 ? r0 : chipRect(w, s, along, v.text, offPx, shiftPx);
          const area = overlapArea(rect);
          const spot = { text: v.text, compact: v.compact, offPx, shiftPx, rect, area };
          if (area === 0) {
            found = spot;
            break;
          }
          if (!best || area < best.area) best = spot;
        }
      }
      if (found) break;
    }
    const spot = found ?? best!;
    placed.push(spot.rect);
    out.set(w.id, { text: spot.text, compact: spot.compact, offPx: spot.offPx, shiftPx: spot.shiftPx, rect: spot.rect });
  }
  return out;
}

/** Стены, длины которых меняются при текущем перетаскивании. */
function liveWalls(walls: readonly Wall[], room: Room, dragWallId: string | null, dragPointId: string | null): Set<string> {
  const set = new Set<string>();
  const n = walls.length;
  if (dragWallId) {
    const i = walls.findIndex((w) => w.id === dragWallId);
    if (i >= 0) {
      set.add(walls[(i - 1 + n) % n].id);
      set.add(walls[(i + 1) % n].id);
    }
  }
  if (dragPointId) {
    const i = room.points.findIndex((p) => p.id === dragPointId);
    if (i >= 0) {
      set.add(walls[i].id);
      set.add(walls[(i - 1 + n) % n].id);
    }
  }
  return set;
}

export const WallLabels = memo(function WallLabels({
  room,
  walls,
  layout,
  s,
  along,
}: {
  room: Room;
  walls: readonly Wall[];
  layout: WallLabelLayout;
  s: number;
  /** Плашки вдоль стен (узкий экран). */
  along: boolean;
}) {
  const selWallId = useAppStore((st) =>
    st.selection?.type === "wall" && st.selection.roomId === room.id ? st.selection.wallId : null,
  );
  const editing = usePlanUi((u) => u.editing);
  const hoverWallId = usePlanUi((u) => (u.hover?.type === "wall" ? u.hover.id : null));
  // Наведение на строку стены в боковой панели — та же подсветка, что и на плане.
  const panelHoverWallId = useAppStore((st) => st.hoverWallId);
  const dragWallId = usePlanUi((u) => (u.drag?.kind === "wall" ? u.drag.wallId : null));
  const dragPointId = usePlanUi((u) => (u.drag?.kind === "point" ? u.drag.pointId : null));
  const live = liveWalls(walls, room, dragWallId, dragPointId);

  const commit = (w: Wall, v: number) => {
    const before = activeRoom();
    useAppStore.getState().setWallLength(w.id, v);
    if (activeRoom() !== before) notePlanEdit();
    else {
      toast(
        v < MIN_WALL || v > MAX_ROOM_EXTENT
          ? `Длина стены — от ${formatLength(MIN_WALL)} до ${formatLength(MAX_ROOM_EXTENT, "m", 0)}`
          : "Такую длину не задать — стены пересекутся",
        "warning",
      );
    }
  };

  return (
    <>
      {walls.map((w) => {
        const spot = layout.get(w.id);
        if (!spot) return null;
        const { compact } = spot;
        const c = onWall(w, w.length / 2 + spot.shiftPx / s, -w.thickness - spot.offPx / s);
        const key = `wall:${w.id}`;
        const ang = along ? uprightAngle(w.dir) : 0;
        const style = { left: c.x * s, top: c.y * s };
        // Наружу от стены в системе плашки: туда расширяем зону касания (к стене — нет, там тап по стене).
        const a = (-ang * Math.PI) / 180;
        const ox = w.normalOut.x * Math.cos(a) - w.normalOut.y * Math.sin(a);
        const oy = w.normalOut.x * Math.sin(a) + w.normalOut.y * Math.cos(a);
        const out = Math.abs(oy) >= Math.abs(ox) ? (oy < 0 ? "up" : "down") : ox < 0 ? "left" : "right";
        const rotStyle =
          Math.abs(ang) > 0.5 ? { ...style, transform: `translate(-50%, -50%) rotate(${Math.round(ang * 10) / 10}deg)` } : style;
        if (editing === key) {
          return (
            <div key={w.id} className="pl-anchor" style={style}>
              <InlineInput
                value={w.length}
                unit="m"
                label={`Длина стены ${w.label}, м`}
                chipKey={key}
                onCommit={(v) => commit(w, v)}
                onClose={() => usePlanUi.getState().setEditing(null)}
              />
            </div>
          );
        }
        const tone = live.has(w.id) ? " is-live" : w.id === selWallId || w.id === dragWallId ? " is-sel" : w.id === hoverWallId || w.id === panelHoverWallId ? " is-hover" : "";
        return (
          // Нажатие ловим на обёртке: тач-коррекция браузера может отдать click ей, а не кнопке.
          <div
            key={w.id}
            className="pl-anchor"
            style={rotStyle}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              selectOnPlan({ type: "wall", roomId: room.id, wallId: w.id });
              usePlanUi.getState().setEditing(key);
            }}
          >
            <button
              type="button"
              data-chip={key}
              data-plan-key={key}
              data-out={out}
              className={`pl-chip pl-chip--wall${compact ? " is-compact" : ""}${tone}`}
              title={compact ? `Стена ${w.label} · ${formatLength(w.length)} — изменить` : `Стена ${w.label} — изменить длину`}
              aria-label={`Стена ${w.label}, ${formatLength(w.length)}. Изменить длину`}
              onPointerEnter={() => usePlanUi.getState().setHover({ type: "wall", id: w.id }, false)}
              onPointerLeave={() => usePlanUi.getState().setHover(null, false)}
            >
              {compact ? (
                <b>{w.label}</b>
              ) : (
                <>
                  <b>{w.label}</b>
                  <span className="pl-chip__sep">·</span>
                  <span className="num">{formatLength(w.length)}</span>
                </>
              )}
            </button>
          </div>
        );
      })}
    </>
  );
});

/* ------------------------------ Проём ------------------------------ */

export interface OpeningDimItem {
  key: string;
  title: string;
  value: number;
  /** Участок вдоль стены, который измеряет размер. */
  from: number;
  to: number;
  /** Где вдоль стены центр плашки. */
  chipAlong: number;
  /** Плашка не влезает в участок — вынесена за угол, к ней ведёт выносная линия. */
  tight: boolean;
  /** Оценка ширины плашки, px. */
  chipPx: number;
  /** Новое значение (м) → offset проёма. */
  apply: (v: number) => number;
}

/** м от внутренней грани до размерных линий выделенного проёма. */
export const openingDimPerp = (o: Opening, s: number, dimPerp: number): number =>
  Math.max(dimPerp, o.kind === "furniture" ? o.depth + 12 / s : dimPerp);

/** Размеры «от левого угла» / «до правого угла» выделенного проёма. */
export function openingDimItems(o: Opening, w: Wall, s: number): OpeningDimItem[] {
  const left = o.offset;
  const right = Math.max(0, w.length - o.offset - o.width);
  const items: OpeningDimItem[] = [];
  const place = (value: number, from: number, to: number, outward: -1 | 1) => {
    const chipPx = formatLength(value, "cm").length * 6.4 + 18;
    const tight = value * s < chipPx + 8;
    const chipAlong = tight
      ? (outward < 0 ? from : to) + (outward * (chipPx / 2 + 10)) / s
      : (from + to) / 2;
    return { chipAlong, tight, chipPx };
  };
  if (left > 0.004) {
    items.push({
      key: `opl:${o.id}`,
      title: "От левого угла",
      value: left,
      from: 0,
      to: left,
      ...place(left, 0, left, -1),
      apply: (v) => v,
    });
  }
  if (right > 0.004) {
    const from = o.offset + o.width;
    items.push({
      key: `opr:${o.id}`,
      title: "До правого угла",
      value: right,
      from,
      to: w.length,
      ...place(right, from, w.length, 1),
      apply: (v) => w.length - o.width - v,
    });
  }
  return items;
}

/**
 * Где поставить плашку размера проёма (вдоль стены и вглубь комнаты, м),
 * чтобы она не легла на плашку стены: у входящего угла плашка, вынесенная
 * за угол, попадает к соседней стене. Пробуем ряд глубже, затем — над самим
 * коротким участком (ещё на ряд глубже), затем два ряда; иначе — как было.
 */
export function dimChipPos(
  w: Wall,
  it: OpeningDimItem,
  perp: number,
  s: number,
  labels: WallLabelLayout,
): { along: number; perp: number } {
  const hw = it.chipPx / 2 + 3;
  const hh = CHIP_H / 2 + 3;
  const row = (CHIP_H + 4) / s;
  const free = (along: number, p: number) => {
    const c = onWall(w, along, p);
    const x = c.x * s;
    const y = c.y * s;
    for (const spot of labels.values()) {
      const r = spot.rect;
      if (r.x0 < x + hw && r.x1 > x - hw && r.y0 < y + hh && r.y1 > y - hh) return false;
    }
    return true;
  };
  const candidates = [
    { along: it.chipAlong, perp },
    { along: it.chipAlong, perp: perp + row },
    ...(it.tight ? [{ along: (it.from + it.to) / 2, perp: perp + row }] : []),
    { along: it.chipAlong, perp: perp + 2 * row },
  ];
  return candidates.find((c) => free(c.along, c.perp)) ?? candidates[0];
}

export const OpeningDimChips = memo(function OpeningDimChips({
  room,
  walls,
  s,
  dimPerp,
  labels,
}: {
  room: Room;
  walls: readonly Wall[];
  s: number;
  dimPerp: number;
  labels: WallLabelLayout;
}) {
  const selId = useAppStore((st) =>
    st.selection?.type === "opening" && st.selection.roomId === room.id ? st.selection.openingId : null,
  );
  const editing = usePlanUi((u) => u.editing);
  const o = selId ? room.openings.find((x) => x.id === selId) : undefined;
  const w = o && walls.find((x) => x.id === o.wallId);
  if (!o || !w) return null;

  const perp = openingDimPerp(o, s, dimPerp);
  const items = openingDimItems(o, w, s);

  return (
    <>
      {items.map((it) => {
        const at = dimChipPos(w, it, perp, s, labels);
        const c = onWall(w, at.along, at.perp);
        const style = { left: c.x * s, top: c.y * s };
        if (editing === it.key) {
          return (
            <div key={it.key} className="pl-anchor" style={style}>
              <InlineInput
                value={it.value}
                unit="cm"
                label={`${it.title}, см`}
                chipKey={it.key}
                onClose={() => usePlanUi.getState().setEditing(null)}
                onCommit={(v) => {
                  const off = it.apply(v);
                  if (off < -1e-6 || off > w.length - o.width + 1e-6) {
                    toast("Проём не поместится — столько места на стене нет", "warning");
                    return;
                  }
                  const before = activeRoom();
                  useAppStore.getState().moveOpening(o.id, w.id, Math.max(0, off));
                  if (activeRoom() !== before) notePlanEdit();
                }}
              />
            </div>
          );
        }
        return (
          <div
            key={it.key}
            className="pl-anchor"
            style={style}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => usePlanUi.getState().setEditing(it.key)}
          >
            <button
              type="button"
              data-chip={it.key}
              data-plan-key={`opening:${o.id}`}
              className={`pl-chip pl-chip--dim${it.tight ? " is-tight" : ""}`}
              title={`${it.title} (как видно из комнаты) — изменить`}
              aria-label={`${it.title}: ${formatLength(it.value, "cm")}. Изменить`}
            >
              <span className="num">{formatLength(it.value, "cm")}</span>
            </button>
          </div>
        );
      })}
    </>
  );
});

/* ------------------------- Ручки для клавиатуры ------------------------- */

/** «90°», «135,5°» */
export const formatAngle = (deg: number): string => `${formatNumber(Math.round(deg * 10) / 10, 1, { trim: true })}°`;

/**
 * Ручка объекта плана для клавиатуры и скринридера: невидима, пока не в
 * фокусе (мышь и палец работают с SVG под ней). Enter — выбрать и открыть
 * панель действий, стрелки — сдвинуть, Delete — удалить.
 */
function KeyHandle({
  planKey,
  label,
  x,
  y,
  kind,
  onPick,
}: {
  planKey: string;
  label: string;
  x: number;
  y: number;
  kind: "point" | "opening";
  onPick: (fromKeyboard: boolean) => void;
}) {
  const elRef = useRef<HTMLButtonElement | null>(null);
  // Ручку удалили (Delete) с фокусом на ней — фокус остаётся на плане.
  const ref = useCallback((el: HTMLButtonElement | null) => {
    if (!el) keepFocusInPlan(elRef.current);
    elRef.current = el;
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      className={`pl-key pl-key--${kind}`}
      data-plan-key={planKey}
      style={{ left: x, top: y }}
      aria-label={label}
      onClick={(e) => onPick(e.detail === 0)}
    />
  );
}

export const KeyHandles = memo(function KeyHandles({
  room,
  walls,
  s,
}: {
  room: Room;
  walls: readonly Wall[];
  s: number;
}) {
  const n = room.points.length;
  return (
    <div className="pl-keys">
      {room.points.map((p, i) => {
        const c = cornerAt(room, i);
        const what = c.kind === "straight" ? "точка на стене" : formatAngle(c.angle);
        return (
          <KeyHandle
            key={p.id}
            planKey={`point:${p.id}`}
            kind="point"
            label={`Угол ${i + 1} из ${n}, ${what}`}
            x={p.x * s}
            y={p.y * s}
            onPick={(kb) => selectOnPlan({ type: "point", roomId: room.id, pointId: p.id }, kb)}
          />
        );
      })}
      {room.openings.map((o) => {
        const w = walls.find((x) => x.id === o.wallId);
        if (!w) return null;
        const c = onWall(w, o.offset + o.width / 2, -w.thickness / 2);
        return (
          <KeyHandle
            key={o.id}
            planKey={`opening:${o.id}`}
            kind="opening"
            label={`${describeOpening(o)}, стена ${w.label}`}
            x={c.x * s}
            y={c.y * s}
            onPick={(kb) => selectOnPlan({ type: "opening", roomId: room.id, openingId: o.id }, kb)}
          />
        );
      })}
    </div>
  );
});

/* --------------------------- Участок плинтуса --------------------------- */

export const SegmentTip = memo(function SegmentTip({ lines, s }: { lines: readonly SkirtLine[]; s: number }) {
  const id = useAppStore((st) => st.hoverSegmentId);
  const dragging = usePlanUi((u) => !!u.drag);
  const l = id && !dragging ? lines.find((x) => x.id === id) : undefined;
  if (!l) return null;
  const mid = { x: (l.p.x + l.q.x) / 2, y: (l.p.y + l.q.y) / 2 };
  const k = 20 / s;
  const style = { left: (mid.x + l.n.x * k) * s, top: (mid.y + l.n.y * k) * s };
  return (
    <div className="pl-anchor pl-anchor--passive" style={style}>
      <div className="pl-chip pl-chip--skirt" role="tooltip">
        <span className="pl-chip__dot" />
        <b>{l.label}</b>
        <span className="pl-chip__sep">·</span>
        <span className="num">{formatLength(l.length)}</span>
      </div>
    </div>
  );
});

/* ------------------------------ Угол ------------------------------ */

export const AngleChip = memo(function AngleChip({ room, s }: { room: Room; s: number }) {
  const pointId = useAppStore((st) =>
    st.selection?.type === "point" && st.selection.roomId === room.id ? st.selection.pointId : null,
  );
  const dragPointId = usePlanUi((u) => (u.drag?.kind === "point" ? u.drag.pointId : null));
  const id = dragPointId ?? pointId;
  const idx = id ? room.points.findIndex((p) => p.id === id) : -1;
  if (idx < 0) return null;
  const c = cornerAt(room, idx);
  const n = room.points.length;
  const prev = room.points[(idx - 1 + n) % n];
  const next = room.points[(idx + 1) % n];
  const d1 = normalize({ x: c.position.x - prev.x, y: c.position.y - prev.y });
  const d2 = normalize({ x: next.x - c.position.x, y: next.y - c.position.y });
  // Биссектриса в сторону комнаты: сумма внутренних нормалей соседних стен.
  let b = normalize({ x: -d1.y - d2.y, y: d1.x + d2.x });
  if (b.x === 0 && b.y === 0) b = { x: -d2.y, y: d2.x };
  const k = 30 / s;
  const style = { left: (c.position.x + b.x * k) * s, top: (c.position.y + b.y * k) * s };
  const deg = Math.round(c.angle * 10) / 10;
  return (
    <div className="pl-anchor" style={style}>
      <div className="pl-chip pl-chip--angle" title="Угол комнаты">
        <span className="num">{formatNumber(deg, 1, { trim: true })}°</span>
      </div>
    </div>
  );
});
