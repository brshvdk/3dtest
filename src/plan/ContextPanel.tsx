/**
 * Контекстная панель выделенного объекта: стена (длина, добавить проём,
 * новый угол), проём (петли, открывание, дублировать, удалить, настроить),
 * вершина (удалить угол). На широком плане — карточка рядом с объектом,
 * не перекрывающая его и как можно меньше закрывающая комнату; на узком —
 * компактный лист внизу экрана.
 *
 * Панель открывает только выбор на самом плане (клик, тап, клавиатура по
 * ручке). Выделение из боковой панели или 3D лишь подсвечивает объект, а
 * проём на шаге «Проёмы» и так открыт в инспекторе слева. Смена шага
 * закрывает панель.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { centroid, cornerAt, getWall, pointInPolygon } from "../domain/geometry";
import { MAX_ROOM_EXTENT, MIN_WALL, removePoint } from "../domain/roomEdit";
import { describeOpening, OPENING_KIND_META, skirtingBlock, wrapsReveals } from "../domain/openings";
import type { Opening, OpeningKind, Room, Vec2, Wall } from "../domain/types";
import { formatLength } from "../domain/units";
import { useAppStore } from "../state/store";
import { Button, Icon, IconButton, LengthField, Segmented, toast, type IconName } from "../ui/kit";
import { onWall, openingExtent } from "./geom";
import { dimChipPos, formatAngle, openingDimItems, openingDimPerp, type WallLabelLayout } from "./Labels";
import { claimSelection, keepFocusInPlan, selectionKey, usePlanUi } from "./planUi";
import { toScreen, type View } from "./viewport";

export const KIND_ICON: Record<OpeningKind, IconName> = {
  door: "door",
  window: "window",
  passage: "passage",
  balcony: "balcony",
  furniture: "furniture",
};

/** «На стене A нет места для …» */
const KIND_GENITIVE: Record<OpeningKind, string> = {
  door: "двери",
  window: "окна",
  passage: "проёма",
  balcony: "балконного блока",
  furniture: "мебели",
};

const ADD_KINDS: Array<{ kind: OpeningKind; label: string }> = [
  { kind: "door", label: "Дверь" },
  { kind: "window", label: "Окно" },
  { kind: "passage", label: "Проём" },
  { kind: "furniture", label: "Мебель" },
];

const activeRoom = (): Room => {
  const s = useAppStore.getState();
  return s.project.rooms.find((r) => r.id === s.activeRoomId) ?? s.project.rooms[0];
};

/* ------------------------------ Содержимое ------------------------------ */

/**
 * full — карточка на большом плане; sheet — лист внизу на телефоне (две
 * строки, кнопки с подписями под палец); bar — одна строка рядом со стеной
 * на небольшом плане (иконки с подсказками), чтобы не закрывать комнату.
 */
type WallVariant = "full" | "sheet" | "bar";

function WallContent({ wall, room, variant }: { wall: Wall; room: Room; variant: WallVariant }) {
  const count = room.openings.filter((o) => o.wallId === wall.id).length;
  const setLength = (v: number) => {
    // Поле применяет значение и по Enter, и по потере фокуса — сравниваем
    // с актуальной длиной из стора, а не с той, что была при отрисовке.
    const before = activeRoom();
    const cur = getWall(before, wall.id);
    if (!cur || Math.abs(v - cur.length) < 1e-4) return;
    useAppStore.getState().setWallLength(wall.id, v);
    if (activeRoom() === before) toast("Такую длину не задать — стены пересекутся", "warning");
  };
  const add = (kind: OpeningKind) => {
    const id = useAppStore.getState().addOpening(kind, { wallId: wall.id });
    // Новый проём выделен — его панель открывается на месте этой.
    if (id) claimSelection();
    else toast(`На стене ${wall.label} не хватает места для ${KIND_GENITIVE[kind]}`, "warning");
  };
  const split = () => {
    const before = activeRoom();
    useAppStore.getState().splitWall(wall.id, Math.round((wall.length / 2) * 1000) / 1000);
    if (activeRoom() === before) toast("Стена слишком короткая, чтобы добавить угол", "warning");
    else claimSelection();
  };
  const close = <IconButton icon="close" label="Закрыть" size="sm" onClick={() => useAppStore.getState().select(null)} />;
  const lengthField = (
    <LengthField
      id={`pl-len-${wall.id}`}
      className="pl-ctx__len"
      ariaLabel={variant === "full" ? undefined : `Длина стены ${wall.label}`}
      value={wall.length}
      min={MIN_WALL}
      max={MAX_ROOM_EXTENT}
      onChange={setLength}
    />
  );
  if (variant === "bar") {
    return (
      <div className="pl-ctx__head">
        <span className="pl-ctx__badge" title={`Стена ${wall.label}`}>
          {wall.label}
        </span>
        {lengthField}
        <span className="pl-ctx__vsep" />
        {ADD_KINDS.map((k) => (
          <IconButton
            key={k.kind}
            className="pl-ctx__add"
            icon={KIND_ICON[k.kind]}
            label={`${k.label} на стену ${wall.label}`}
            size="sm"
            onClick={() => add(k.kind)}
          />
        ))}
        <IconButton
          className="pl-ctx__add"
          icon="add-corner"
          label="Угол посередине стены"
          size="sm"
          onClick={split}
        />
        <span className="pl-ctx__vsep" />
        {close}
      </div>
    );
  }
  const adds = ADD_KINDS.map((k) => (
    <Button key={k.kind} size="sm" icon={KIND_ICON[k.kind]} onClick={() => add(k.kind)} title={OPENING_KIND_META[k.kind].hint}>
      {k.label}
    </Button>
  ));
  if (variant === "sheet") {
    // Телефон: панель внизу и так закрывает часть плана — всё в две строки.
    return (
      <>
        <div className="pl-ctx__head">
          <span className="pl-ctx__badge">{wall.label}</span>
          <div className="pl-ctx__titles">
            <div className="pl-ctx__title">Стена {wall.label}</div>
          </div>
          {lengthField}
          {close}
        </div>
        <div className="pl-ctx__adds pl-ctx__adds--5">
          {adds}
          <Button size="sm" icon="plus" onClick={split} title="Добавить угол посередине стены">
            Угол
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="pl-ctx__head">
        <span className="pl-ctx__badge">{wall.label}</span>
        <div className="pl-ctx__titles">
          <div className="pl-ctx__title">Стена {wall.label}</div>
          <div className="pl-ctx__sub">
            {count ? `Проёмов на стене: ${count}` : "Тяните стену или введите длину"}
          </div>
        </div>
        {close}
      </div>
      <div className="pl-ctx__row">
        <label className="pl-ctx__label" htmlFor={`pl-len-${wall.id}`}>
          Длина
        </label>
        {lengthField}
        <Button size="sm" variant="ghost" icon="plus" onClick={split} title="Разделить стену точкой посередине">
          Добавить угол
        </Button>
      </div>
      <div className="pl-ctx__cap">Добавить на стену</div>
      <div className="pl-ctx__adds">{adds}</div>
    </>
  );
}

/** Как проём влияет на плинтус — коротко, для подзаголовка (short — для компактной панели). */
function skirtingEffect(o: Opening, wall: Wall, skirtH: number, short: boolean): { text: string; none: boolean } {
  const block = skirtingBlock(o, skirtH);
  if (!block) {
    if (short) return { text: "Не влияет на плинтус", none: true };
    return { text: o.kind === "window" ? "Окно выше плинтуса — не влияет" : "Не влияет на плинтус", none: true };
  }
  const len = Math.max(0, Math.min(wall.length, block.to) - Math.max(0, block.from));
  const reveals = wrapsReveals(o) ? formatLength(2 * wall.thickness, "cm") : "";
  if (short) return { text: `Плинтус −${formatLength(len, "cm")}${reveals ? ` · +${reveals} откосы` : ""}`, none: false };
  let text = `Плинтус прерывается на ${formatLength(len, "cm")}`;
  if (reveals) text += ` · +${reveals} в откосы`;
  return { text, none: false };
}

function OpeningContent({ o, wall, skirtH, compact }: { o: Opening; wall: Wall; skirtH: number; compact: boolean }) {
  const st = useAppStore.getState;
  const update = (patch: Partial<Opening>) => st().updateOpening(o.id, patch);
  const effect = skirtingEffect(o, wall, skirtH, compact);
  const sides = o.kind === "door" || o.kind === "balcony";
  const duplicate = () => {
    st().duplicateOpening(o.id);
    claimSelection();
  };
  const settings = (
    <Button size="sm" icon="settings" onClick={() => st().setPanelTab("openings")} title="Размеры и все параметры — в панели «Проёмы»">
      Настроить
    </Button>
  );
  const remove = (
    <IconButton
      className="pl-ctx__end"
      icon="trash"
      label="Удалить"
      size="sm"
      variant="danger"
      onClick={() => st().removeOpening(o.id)}
    />
  );
  const close = <IconButton icon="close" label="Закрыть" size="sm" onClick={() => st().select(null)} />;
  const opts =
    o.kind === "door" ? (
      <div className="pl-ctx__opts">
        {o.leaves === 1 ? (
          <div className="pl-ctx__opt">
            <span className="pl-ctx__label" title="Если смотреть изнутри комнаты, лицом к двери">
              Петли
            </span>
            <Segmented
              size="sm"
              value={o.hinge}
              ariaLabel="Сторона петель"
              onChange={(hinge) => update({ hinge })}
              options={[
                { value: "left", label: "Слева" },
                { value: "right", label: "Справа" },
              ]}
            />
          </div>
        ) : null}
        <div className="pl-ctx__opt">
          {compact ? null : <span className="pl-ctx__label">Открывается</span>}
          <Segmented
            size="sm"
            value={o.swing}
            ariaLabel="Куда открывается дверь"
            onChange={(swing) => update({ swing })}
            options={[
              { value: "in", label: "Внутрь" },
              { value: "out", label: "Наружу" },
            ]}
          />
        </div>
      </div>
    ) : o.kind === "balcony" ? (
      <div className="pl-ctx__opts">
        <div className="pl-ctx__opt">
          <span className="pl-ctx__label" title="Если смотреть изнутри комнаты">
            Дверь
          </span>
          <Segmented
            size="sm"
            value={o.balconyDoorSide}
            ariaLabel="Сторона балконной двери"
            onChange={(balconyDoorSide) => update({ balconyDoorSide })}
            options={[
              { value: "left", label: "Слева" },
              { value: "right", label: "Справа" },
            ]}
          />
        </div>
      </div>
    ) : null;
  const titles = (
    <div className="pl-ctx__titles">
      <div className="pl-ctx__title">
        {describeOpening(o)} <span className="pl-ctx__wall">· стена {wall.label}</span>
      </div>
      <div className={`pl-ctx__sub pl-ctx__sub--skirt${effect.none ? " pl-ctx__sub--none" : ""}`}>
        <span>{effect.text}</span>
      </div>
    </div>
  );
  const icon = (
    <span className={`pl-ctx__icon pl-ctx__icon--${o.kind}`}>
      <Icon name={KIND_ICON[o.kind]} size={17} />
    </span>
  );
  if (compact) {
    // Одна строка с действиями-иконками (+ строка переключателей у двери и балкона):
    // лист не закрывает полплана. «Дублировать» и остальное — в «Настроить».
    return (
      <>
        <div className="pl-ctx__head">
          {icon}
          {titles}
          <IconButton
            icon="settings"
            label="Настроить: размеры и все параметры"
            size="sm"
            onClick={() => st().setPanelTab("openings")}
          />
          {remove}
          {close}
        </div>
        {opts}
      </>
    );
  }
  return (
    <>
      <div className="pl-ctx__head">
        {icon}
        {titles}
        {close}
      </div>
      {opts}
      {sides ? <p className="pl-ctx__hint">Слева/справа — если смотреть из комнаты на стену.</p> : null}
      <div className="pl-ctx__actions">
        {settings}
        <Button size="sm" icon="copy" onClick={duplicate} title="Копия рядом на той же стене">
          Дублировать
        </Button>
        {remove}
      </div>
    </>
  );
}

function PointContent({ room, pointId, variant }: { room: Room; pointId: string; variant: WallVariant }) {
  const idx = room.points.findIndex((p) => p.id === pointId);
  if (idx < 0) return null;
  const corner = cornerAt(room, idx);
  const canRemove = removePoint(room, pointId) !== room;
  const remove = () => useAppStore.getState().removePoint(pointId);
  const why = canRemove ? "Соседние стены сольются в одну" : "Нельзя: у комнаты должно остаться 3 стены без пересечений";
  const del =
    variant === "bar" ? (
      <IconButton
        icon="trash"
        label={canRemove ? "Удалить угол — соседние стены сольются в одну" : "Удалить угол нельзя"}
        size="sm"
        variant="danger"
        disabled={!canRemove}
        onClick={remove}
      />
    ) : (
      <Button size="sm" variant="danger" icon="trash" disabled={!canRemove} onClick={remove} title={why}>
        Удалить угол
      </Button>
    );
  const note = !canRemove ? <span className="pl-ctx__note">Без этого угла комната станет некорректной</span> : null;
  return (
    <>
      <div className="pl-ctx__head">
        <span className="pl-ctx__icon pl-ctx__icon--point">
          <span className="pl-ctx__dot" />
        </span>
        <div className="pl-ctx__titles">
          <div className="pl-ctx__title">
            {corner.kind === "straight" ? "Точка на стене" : `Угол ${formatAngle(corner.angle)}`}
          </div>
          <div className="pl-ctx__sub pl-ctx__sub--wrap">Тяните — меняется форма</div>
        </div>
        {variant !== "full" ? del : null}
        <IconButton icon="close" label="Закрыть" size="sm" onClick={() => useAppStore.getState().select(null)} />
      </div>
      {variant !== "full" ? (
        note
      ) : (
        <div className="pl-ctx__actions">
          {del}
          {note}
        </div>
      )}
    </>
  );
}

/* ------------------------------ Положение ------------------------------ */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxOf(points: readonly Vec2[], view: View, pad = 0): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    const q = toScreen(view, p);
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/** Экранный габарит выделения и направление «в комнату» (куда лучше ставить панель). */
export function selectionBox(
  room: Room,
  walls: readonly Wall[],
  sel: NonNullable<ReturnType<typeof useAppStore.getState>["selection"]>,
  view: View,
  dimPerp: number,
  labels: WallLabelLayout,
): { box: Box; dir: Vec2; anchor: Vec2 } | null {
  const s = view.s;
  if (sel.type === "wall") {
    const w = walls.find((x) => x.id === sel.wallId);
    if (!w) return null;
    const off = (labels.get(w.id)?.offPx ?? 20) + 14;
    // Вместе с проёмами стены (дуги дверей, мебель) — панель их не закроет.
    let inward = 0;
    for (const o of room.openings) {
      if (o.wallId === w.id) inward = Math.max(inward, openingExtent(o, w).p1);
    }
    const pts = [
      onWall(w, 0, inward),
      onWall(w, w.length, inward),
      onWall(w, 0, -w.thickness - off / s),
      onWall(w, w.length, -w.thickness - off / s),
    ];
    return { box: boxOf(pts, view, 6), dir: w.normalIn, anchor: toScreen(view, onWall(w, w.length / 2, 0)) };
  }
  if (sel.type === "opening") {
    const o = room.openings.find((x) => x.id === sel.openingId);
    const w = o && walls.find((x) => x.id === o.wallId);
    if (!o || !w) return null;
    const e = openingExtent(o, w);
    let p1 = Math.max(e.p1, dimPerp + 16 / s, o.kind === "furniture" ? o.depth + 26 / s : 0);
    // Вместе с плашками размеров, вынесенными за угол (короткий участок у угла) или отведёнными вглубь.
    let a0 = e.a0;
    let a1 = e.a1;
    const perp = openingDimPerp(o, s, dimPerp);
    for (const it of openingDimItems(o, w, s)) {
      const at = dimChipPos(w, it, perp, s, labels);
      if (!it.tight && at.perp === perp) continue;
      a0 = Math.min(a0, at.along - it.chipPx / 2 / s);
      a1 = Math.max(a1, at.along + it.chipPx / 2 / s);
      p1 = Math.max(p1, at.perp + 16 / s);
    }
    const pts = [onWall(w, a0, e.p0), onWall(w, a1, e.p0), onWall(w, a0, p1), onWall(w, a1, p1)];
    return {
      box: boxOf(pts, view, 8),
      dir: w.normalIn,
      anchor: toScreen(view, onWall(w, o.offset + o.width / 2, 0)),
    };
  }
  const p = room.points.find((x) => x.id === sel.pointId);
  if (!p) return null;
  const c = centroid(room.points);
  const dx = c.x - p.x;
  const dy = c.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  return { box: boxOf([p], view, 46), dir: { x: dx / len, y: dy / len }, anchor: toScreen(view, p) };
}

type Side = "below" | "above" | "right" | "left";

/** Доля прямоугольника (x, y, w, h), лежащая на полу комнаты (poly — экранные px), в px². */
function floorOverlap(poly: readonly Vec2[], x: number, y: number, w: number, h: number): number {
  const N = 6;
  const M = 4;
  let n = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      if (pointInPolygon({ x: x + ((i + 0.5) * w) / N, y: y + ((j + 0.5) * h) / M }, poly)) n++;
    }
  }
  return (n / (N * M)) * w * h;
}

/**
 * Место для панели рядом с выделением (box). Панель не должна закрывать
 * ручки углов и плашки стен (avoid, экранные px): иначе за соседний угол не
 * ухватиться, а размер не прочитать. И как можно меньше закрывать пол
 * комнаты (floor — её контур на экране): сначала пробуем снаружи стены
 * (против dir — направления в комнату), потом сбоку, потом внутри. Из
 * положений без помех берём то, что меньше всего закрывает комнату.
 */
function place(
  box: Box,
  dir: Vec2,
  pw: number,
  ph: number,
  W: number,
  H: number,
  avoid: readonly Box[],
  floor: readonly Vec2[],
): { x: number; y: number } | null {
  const gap = 10;
  const m = 8;
  const vertical: Side[] = dir.y >= 0 ? ["above", "below"] : ["below", "above"];
  const horizontal: Side[] = dir.x >= 0 ? ["left", "right"] : ["right", "left"];
  const order = Math.abs(dir.y) >= Math.abs(dir.x) ? [...vertical, ...horizontal] : [...horizontal, ...vertical];
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const clampX = (x: number) => Math.min(W - pw - m, Math.max(m, x));
  const clampY = (y: number) => Math.min(H - ph - m, Math.max(m, y));
  // То, что входит в само выделение (концы стены, её плашка), не считаем.
  const others = avoid.filter((a) => {
    const cx = (a.x0 + a.x1) / 2;
    const cy = (a.y0 + a.y1) / 2;
    return cx < box.x0 || cx > box.x1 || cy < box.y0 || cy > box.y1;
  });
  const hits = (x: number, y: number) => {
    const pad = 4;
    let n = 0;
    for (const a of others) {
      if (a.x1 > x - pad && a.x0 < x + pw + pad && a.y1 > y - pad && a.y0 < y + ph + pad) n++;
    }
    return n;
  };
  let best: { x: number; y: number; score: number } | null = null;
  for (let rank = 0; rank < order.length; rank++) {
    const side = order[rank];
    const candidates: Array<{ x: number; y: number }> = [];
    if (side === "below" || side === "above") {
      const y = side === "below" ? box.y1 + gap : box.y0 - gap - ph;
      if (side === "below" ? y + ph > H - m : y < m) continue;
      const xs = [cx - pw / 2, box.x0, box.x1 - pw, box.x1 + gap - pw / 2, box.x0 - gap - pw / 2];
      // Вплотную к помехам в этой полосе — слева и справа от них.
      for (const a of others) if (a.y1 > y && a.y0 < y + ph) xs.push(a.x0 - 6 - pw, a.x1 + 6);
      for (const x of xs) candidates.push({ x: clampX(x), y });
    } else {
      const x = side === "right" ? box.x1 + gap : box.x0 - gap - pw;
      if (side === "right" ? x + pw > W - m : x < m) continue;
      const ys = [cy - ph / 2, box.y0, box.y1 - ph];
      for (const a of others) if (a.x1 > x && a.x0 < x + pw) ys.push(a.y0 - 6 - ph, a.y1 + 6);
      for (const y of ys) candidates.push({ x, y: clampY(y) });
    }
    for (const c of candidates) {
      // Помеха — почти запрет; закрытый пол — px²; порядок сторон — при равенстве.
      const score = hits(c.x, c.y) * 1e7 + floorOverlap(floor, c.x, c.y, pw, ph) + rank;
      if (!best || score < best.score) best = { ...c, score };
    }
  }
  return best;
}

/* ------------------------------ Панель ------------------------------ */

/** План ниже — панель рядом с объектом в компактном виде (как лист на телефоне). */
const COMPACT_H = 600;

/**
 * Панель открыта: выделение сделано на плане (та же ссылка, что запомнил
 * план) и проём не открыт в инспекторе на шаге «Проёмы».
 */
export function useContextShown(roomId: string): boolean {
  const sel = useAppStore((st) => st.selection);
  const tab = useAppStore((st) => st.panelTab);
  const owner = usePlanUi((u) => u.ctxFor);
  return !!sel && sel.roomId === roomId && sel === owner && !(sel.type === "opening" && tab === "openings");
}

export interface ContextPanelProps {
  room: Room;
  walls: readonly Wall[];
  view: View;
  width: number;
  height: number;
  /** Всегда внизу (узкий план / телефон). */
  docked: boolean;
  /** Палец: внизу — лист с крупными подписанными кнопками; мышь — строка иконок. */
  coarse: boolean;
  dimPerp: number;
  /** Высота плинтуса, м — чтобы сказать, влияет ли проём. */
  skirtH: number;
  /** Раскладка плашек стен (габарит выделенной стены вместе с плашкой). */
  labels: WallLabelLayout;
  /** px сверху, занятые сводкой комнаты: показывая выделение, не ставим его под неё. */
  topInset: number;
  /** Меняется — показать выделение заново (после перетаскивания объекта). */
  revealTick: number;
  /**
   * Выделение не видно (за краем экрана или под панелью внизу) — просим
   * сдвинуть вид на (dx, dy) px. Вызывается один раз на выделение.
   */
  onReveal: (dx: number, dy: number) => void;
}

export function ContextPanel({
  room,
  walls,
  view,
  width,
  height,
  docked,
  coarse,
  dimPerp,
  skirtH,
  labels,
  topInset,
  revealTick,
  onReveal,
}: ContextPanelProps) {
  const sel = useAppStore((st) => (st.selection && st.selection.roomId === room.id ? st.selection : null));
  const shown = useContextShown(room.id);
  const tab = useAppStore((st) => st.panelTab);
  const dragging = usePlanUi((u) => !!u.drag && u.drag.kind !== "pan");
  // Длину стены вводят прямо в плашке — второе поле той же длины в панели только мешает.
  const chipEditing = usePlanUi((u) => !!u.editing && u.editing.startsWith("wall:"));
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const compact = docked || height < COMPACT_H;
  const variant: WallVariant = docked && coarse ? "sheet" : compact ? "bar" : "full";

  // Смена шага закрывает панель (выделение остаётся подсвеченным).
  const lastTab = useRef(tab);
  useEffect(() => {
    if (lastTab.current === tab) return;
    lastTab.current = tab;
    usePlanUi.getState().setCtxFor(null);
  }, [tab]);

  // Размер панели — ResizeObserver (без принудительной раскладки на каждом кадре пана).
  const ro = useRef<ResizeObserver | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    // Панель закрылась (крестик, удаление, Esc, смена шага) с фокусом внутри — фокус на план.
    if (!el) keepFocusInPlan(elRef.current);
    elRef.current = el;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setSize((cur) => (cur && cur.w === w && cur.h === h ? cur : { w, h }));
    };
    measure();
    ro.current = new ResizeObserver(measure);
    ro.current.observe(el);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);

  // Открыли с клавиатуры (Enter на ручке) — фокус в панель.
  const focusIn = usePlanUi((u) => u.ctxFocus);
  // Ждём замера: в невидимую (is-measuring) панель фокус не ставится.
  useLayoutEffect(() => {
    if (!focusIn || !shown || !size) return;
    usePlanUi.getState().setCtxFocus(false);
    // Первое поле или кнопка, но не «Удалить»: второй Enter не должен ничего удалить.
    elRef.current
      ?.querySelector<HTMLElement>("input, button:not(:disabled):not(.k-btn--danger)")
      ?.focus({ preventScroll: true });
  }, [focusIn, shown, size]);

  let content: JSX.Element | null = null;
  let label = "";
  if (sel?.type === "wall") {
    const w = walls.find((x) => x.id === sel.wallId);
    if (w) content = <WallContent wall={w} room={room} variant={variant} />;
    label = w ? `Стена ${w.label}` : "";
  } else if (sel?.type === "opening") {
    const o = room.openings.find((x) => x.id === sel.openingId);
    const w = o && walls.find((x) => x.id === o.wallId);
    if (o && w) content = <OpeningContent o={o} wall={w} skirtH={skirtH} compact={compact} />;
    label = o ? describeOpening(o) : "";
  } else if (sel?.type === "point") {
    content = <PointContent room={room} pointId={sel.pointId} variant={variant} />;
    label = "Угол комнаты";
  }
  const visible = shown && !!content;

  let pos: { x: number; y: number } | null = null;
  if (visible && sel && !docked && size) {
    const sb = selectionBox(room, walls, sel, view, dimPerp, labels);
    if (sb) {
      const avoid: Box[] = room.points.map((p) => {
        const q = toScreen(view, p);
        return { x0: q.x - 10, y0: q.y - 10, x1: q.x + 10, y1: q.y + 10 };
      });
      for (const spot of labels.values()) {
        const r = spot.rect;
        avoid.push({ x0: r.x0 + view.tx, y0: r.y0 + view.ty, x1: r.x1 + view.tx, y1: r.y1 + view.ty });
      }
      const floor = room.points.map((p) => toScreen(view, p));
      pos = place(sb.box, sb.dir, size.w, size.h, width, height, avoid, floor);
    }
  }
  const isDocked = docked || (!!size && !pos);

  // Лист внизу — вписывание комнаты оставляет над ним место.
  const sheetH = visible && isDocked && size ? size.h : 0;
  useEffect(() => {
    usePlanUi.getState().setSheetH(sheetH);
  }, [sheetH]);
  useEffect(() => () => usePlanUi.getState().setSheetH(0), []);

  // Новое выделение (в т.ч. из списка в панели или 3D) должно быть на виду —
  // над листом, если он открыт, и не под сводкой комнаты.
  const selKey = selectionKey(sel);
  const revealKey = sel ? `${selKey}${visible ? "+" : ""}#${revealTick}` : "";
  const revealed = useRef("");
  useEffect(() => {
    if (!sel) {
      revealed.current = "";
      return;
    }
    if ((visible && !size) || dragging || revealed.current === revealKey) return;
    revealed.current = revealKey;
    const sb = selectionBox(room, walls, sel, view, dimPerp, labels);
    if (!sb) return;
    const m = 12;
    // Высота только что смонтированной панели (size ещё может быть от прежнего выделения).
    const panelH = visible && isDocked ? (elRef.current?.offsetHeight ?? size?.h ?? 0) : 0;
    const bottom = panelH ? height - panelH - 16 : height - m;
    const b = sb.box;
    let dx = 0;
    let dy = 0;
    if (b.x1 - b.x0 <= width - 2 * m) {
      if (b.x0 < m) dx = m - b.x0;
      else if (b.x1 > width - m) dx = width - m - b.x1;
    }
    if (b.y1 > bottom) dy = bottom - b.y1;
    if (b.y0 + dy < topInset) dy = topInset - b.y0;
    // Всё выделение не влезает над панелью — главное, чтобы был виден сам объект на стене.
    const a = sb.anchor;
    const top = topInset + 24;
    const low = bottom - 24;
    if (low > top && (a.y + dy < top || a.y + dy > low)) dy = (top + low) / 2 - a.y;
    // Выделение почти целиком на виду (у края только плашка) — вид не дёргаем.
    if (Math.abs(dx) > m || Math.abs(dy) > m) onReveal(dx, dy);
  });

  if (!visible || !sel) return null;

  // Esc внутри панели закрывает её и возвращает фокус на объект плана (поле ввода обрабатывает Esc само).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || (e.target as HTMLElement).tagName === "INPUT") return;
    e.preventDefault();
    e.stopPropagation();
    const root = elRef.current?.closest<HTMLElement>(".pl-root");
    const handle = root?.querySelector<HTMLElement>(`[data-plan-key="${selKey}"]`);
    (handle ?? root)?.focus({ preventScroll: true });
    usePlanUi.getState().setCtxFor(null);
  };

  const style = isDocked || !pos ? undefined : { left: Math.round(pos.x), top: Math.round(pos.y) };

  return (
    <div
      ref={ref}
      key={selKey}
      className={`pl-ctx${isDocked ? " is-docked" : ""}${compact ? " is-compact" : ""}${variant === "bar" && sel.type !== "opening" ? " is-bar" : ""}${dragging || chipEditing ? " is-hidden" : ""}${!size ? " is-measuring" : ""}`}
      style={style}
      role="group"
      aria-label={label ? `${label}: действия` : "Действия с выделенным"}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {content}
    </div>
  );
}
