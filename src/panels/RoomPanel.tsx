/**
 * Шаг 1 · Комната: название, форма (шаблоны), размеры стен, высота и
 * толщина стен, сводка (площадь, периметр, объём, площадь стен).
 * Все правки — через стор; поля длины синхронны с перетаскиванием на плане.
 */
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  type FocusEvent,
  type PointerEvent,
} from "react";
import { ROOM_HEIGHT_RANGE, WALL_THICKNESS_RANGE } from "../domain/project";
import { MIN_WALL } from "../domain/roomEdit";
import { ROOM_NAME_SUGGESTIONS, ROOM_TEMPLATES, buildTemplatePoints } from "../domain/roomTemplates";
import type { Point, Room, RoomShapeId, Wall } from "../domain/types";
import { formatArea, formatLength, formatVolume, plural } from "../domain/units";
import { useActiveRoom, useRoomMetrics, useWalls } from "../state/hooks";
import { useAppStore } from "../state/store";
import {
  Disclosure,
  Icon,
  IconButton,
  LengthField,
  Section,
  Switch,
  TextField,
  confirmAction,
  rovingFocusIndex,
} from "../ui/kit";
import { notify } from "./notify";
import { rovingFocusKeyDown } from "./roving";
import { ShapeIcon } from "./ShapeIcon";
import "./panels.css";

/**
 * Короткие подписи карточек (полное описание — во всплывающей подсказке).
 * Без мягких переносов: слово не рвётся по слогам, «Г‑образная» — с неразрывным дефисом.
 */
const SHAPE_LABEL: Record<RoomShapeId, string> = {
  rect: "Прямоугольная",
  L: "Г\u2011образная",
  U: "П\u2011образная",
  T: "Т\u2011образная",
  "corner-box": "С коробом",
  bay: "С эркером",
  trapezoid: "Скошенная",
  custom: "Своя",
};

/** Как вернуть удалённое: сочетание клавиш — только там, где есть клавиатура и мышь. */
function undoHint(): string {
  const fine = typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;
  return fine ? "Вернуть можно кнопкой «Отменить» (Ctrl+Z)." : "Вернуть можно кнопкой «Отменить».";
}

/** Максимальная длина стены в поле ввода, м. */
const MAX_WALL_INPUT = 50;

const getActiveRoom = (): Room => {
  const s = useAppStore.getState();
  return s.project.rooms.find((r) => r.id === s.activeRoomId) ?? s.project.rooms[0];
};

/** Длина стены через стор + понятное сообщение, если такую длину не задать. */
function commitWallLength(wallId: string, length: number) {
  const before = getActiveRoom();
  const wall = before.points.findIndex((p) => p.id === wallId);
  if (wall < 0) return;
  useAppStore.getState().setWallLength(wallId, length);
  if (getActiveRoom() === before) {
    const cur = before.points[wall];
    const next = before.points[(wall + 1) % before.points.length];
    if (Math.abs(Math.hypot(next.x - cur.x, next.y - cur.y) - length) > 1e-4) {
      notify("Такую длину не задать — стены пересекутся", "warning");
    }
  }
}

/* ------------------------------------------------------------------ */

export function RoomPanel() {
  const room = useActiveRoom();
  const roomsCount = useAppStore((s) => s.project.rooms.length);
  return (
    <div className="pn">
      <RoomNameSection
        roomId={room.id}
        name={room.name}
        skirtingEnabled={room.skirtingEnabled}
        roomsCount={roomsCount}
      />
      <ShapeSection shape={room.shape} points={room.shape === "custom" ? room.points : undefined} />
      <SizesSection room={room} />
      <RoomSummary />
    </div>
  );
}

/* --------------------------- Название ----------------------------- */

const RoomNameSection = memo(function RoomNameSection({
  roomId,
  name,
  skirtingEnabled,
  roomsCount,
}: {
  roomId: string;
  name: string;
  skirtingEnabled: boolean;
  roomsCount: number;
}) {
  const listId = useId();
  const dupId = useId();
  const onRename = useCallback((v: string) => useAppStore.getState().renameRoom(roomId, v), [roomId]);
  const onDuplicate = () => {
    useAppStore.getState().duplicateRoom(roomId);
    notify(`Создана копия комнаты «${name}»`);
  };
  const onRemove = async () => {
    if (roomsCount <= 1) return;
    const ok = await confirmAction({
      title: `Удалить комнату «${name}»?`,
      message: `Комната со всеми дверями, окнами и мебелью пропадёт из проекта и расчёта. ${undoHint()}`,
      confirmLabel: "Удалить",
      tone: "danger",
    });
    // Пока диалог был открыт, комнату могли удалить или она осталась последней.
    const s = useAppStore.getState();
    if (!ok || s.project.rooms.length <= 1 || !s.project.rooms.some((r) => r.id === roomId)) return;
    s.removeRoom(roomId);
    notify(`Комната «${name}» удалена`, "info");
    // Осталась одна комната — кнопка удаления выключена и фокус с неё слетает на <body>.
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body || (a instanceof HTMLButtonElement && a.disabled)) {
        document.getElementById(dupId)?.focus();
      }
    });
  };

  return (
    <Section
      step={1}
      title="Комната"
      subtitle="Название, форма и размеры"
      actions={
        <>
          <IconButton id={dupId} icon="copy" label="Дублировать комнату" size="sm" onClick={onDuplicate} />
          <IconButton
            icon="trash"
            label={roomsCount <= 1 ? "Единственную комнату удалить нельзя" : "Удалить комнату"}
            size="sm"
            onClick={onRemove}
            disabled={roomsCount <= 1}
          />
        </>
      }
    >
      <TextField
        label="Название"
        value={name}
        onChange={onRename}
        placeholder="Например, Гостиная"
        list={listId}
        maxLength={60}
      />
      <datalist id={listId}>
        {ROOM_NAME_SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <Switch
        checked={skirtingEnabled}
        onChange={(v) => useAppStore.getState().updateRoom({ skirtingEnabled: v })}
        label="Учитывать в расчёте плинтуса"
        hint={
          skirtingEnabled
            ? "Комната входит в итог и список покупок"
            : "Комната не считается — например, если плинтус там уже есть"
        }
      />
    </Section>
  );
});

/* ----------------------------- Форма ------------------------------ */

/** Число стен шаблона (для предупреждения о проёмах). */
const wallsCountCache = new Map<RoomShapeId, number>();
function templateWallCount(id: RoomShapeId): number {
  let n = wallsCountCache.get(id);
  if (n === undefined) {
    n = buildTemplatePoints(id).length;
    wallsCountCache.set(id, n);
  }
  return n;
}

/** Параметры шаблона из габаритов текущей комнаты: форма меняется, размер — нет. */
function paramsFromRoom(room: Room, id: RoomShapeId): Record<string, number> {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of room.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const cm = (v: number) => Math.round(v * 100) / 100;
  const w = cm(maxX - minX);
  const h = cm(maxY - minY);
  if (id === "trapezoid") return { lengthTop: w, lengthBottom: cm(w * 0.78), width: h };
  return { length: w, width: h };
}

const ShapeSection = memo(function ShapeSection({
  shape,
  points,
}: {
  shape: RoomShapeId;
  /** Только для своей формы — иначе секция не перерисовывается при правке стен. */
  points?: Point[];
}) {
  const apply = async (id: RoomShapeId) => {
    if (id === shape) return;
    const room = getActiveRoom();
    if (room.openings.length > 0 && templateWallCount(id) !== room.points.length) {
      const name = ROOM_TEMPLATES.find((t) => t.id === id)?.name ?? SHAPE_LABEL[id];
      const ok = await confirmAction({
        title: "Сменить форму комнаты?",
        message: `У формы «${name}» другое число стен. Двери и окна расставим заново, а те, что не поместятся, удалим. ${undoHint()}`,
        confirmLabel: "Сменить форму",
        tone: "primary",
      });
      // Пока диалог был открыт, могли переключить комнату или уже сменить форму.
      const now = getActiveRoom();
      if (!ok || now.id !== room.id || now.shape === id) return;
    }
    const current = getActiveRoom();
    const before = current.openings.length;
    useAppStore.getState().applyTemplate(id, paramsFromRoom(current, id));
    const lost = before - getActiveRoom().openings.length;
    if (lost === 1) notify("Один проём не поместился в новую форму и удалён", "warning");
    else if (lost > 1) notify(`${plural(lost, ["проём", "проёма", "проёмов"])} не поместились в новую форму и удалены`, "warning");
  };

  const isCustom = shape === "custom";
  // Одна остановка Tab на группу: выбранная форма (своя — статичная карточка).
  const focusIndex = isCustom ? -1 : rovingFocusIndex(ROOM_TEMPLATES, (t) => t.id === shape);
  return (
    <Section
      title="Форма комнаты"
      subtitle={
        isCustom
          ? "Своя форма — вы изменили её на плане"
          : "Выберите похожую, точные размеры — ниже"
      }
    >
      <div className="pn-shapes" role="radiogroup" aria-label="Форма комнаты" onKeyDown={rovingFocusKeyDown}>
        {ROOM_TEMPLATES.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={t.id === shape}
            tabIndex={i === focusIndex ? 0 : -1}
            className={`pn-shape-card${t.id === shape ? " is-active" : ""}`}
            title={`${t.name}. ${t.description}`}
            onClick={() => void apply(t.id)}
          >
            <ShapeIcon shape={t.id} size={34} />
            <span className="pn-shape-card__label">{SHAPE_LABEL[t.id]}</span>
          </button>
        ))}
        {isCustom ? (
          <div
            className="pn-shape-card is-active is-static"
            role="radio"
            aria-checked
            tabIndex={0}
            title="Форма изменена на плане"
          >
            <ShapeIcon shape="custom" points={points} size={34} />
            <span className="pn-shape-card__label">{SHAPE_LABEL.custom}</span>
          </div>
        ) : (
          <button
            type="button"
            className="pn-shape-card is-hint"
            title="Своя форма: тяните углы на плане, двойной клик по стене — новый угол"
            onClick={() =>
              notify("Своя форма: тяните углы на плане, двойной клик по стене добавит угол", "info")
            }
          >
            <ShapeIcon shape="custom" size={34} dashed />
            <span className="pn-shape-card__label">{SHAPE_LABEL.custom}</span>
          </button>
        )}
      </div>
    </Section>
  );
});

/* ---------------------------- Размеры ----------------------------- */

/**
 * Наведение и фокус на строку стены подсвечивают её на плане и в 3D
 * (hoverWallId в сторе): выделение и вид не меняются, иначе план сдвигается
 * к стене, а Delete и стрелки получают случайную цель. Выделить стену —
 * клик по её букве.
 */
function useWallHover(roomId: string) {
  /** Стена под указателем и стена с фокусом, плюс что мы сами поставили в стор. */
  const st = useRef<{ pointer: string | null; focus: string | null; mine: string | null }>({
    pointer: null,
    focus: null,
    mine: null,
  });
  const hl = useMemo(() => {
    const sync = () => {
      const cur = st.current;
      const want = cur.pointer ?? cur.focus;
      const s = useAppStore.getState();
      if (want) s.setHoverWall(want);
      // Снимаем только свою подсветку: её мог поставить другой источник (план, итог).
      else if (cur.mine && s.hoverWallId === cur.mine) s.setHoverWall(null);
      cur.mine = want;
    };
    // Касание тоже присылает pointerenter, а pointerleave — только при следующем касании:
    // подсветка «залипла» бы; на сенсорном экране подсвечивает фокус поля.
    const isMouse = (e: PointerEvent) => e.pointerType !== "touch";
    return {
      enter(wallId: string, e: PointerEvent) {
        if (!isMouse(e)) return;
        st.current.pointer = wallId;
        sync();
      },
      leave(wallId: string, e: PointerEvent) {
        if (!isMouse(e) || st.current.pointer !== wallId) return;
        st.current.pointer = null;
        sync();
      },
      focus(wallId: string) {
        st.current.focus = wallId;
        sync();
      },
      blur(wallId: string, e: FocusEvent<HTMLElement>) {
        // Фокус переходит внутри строки (поле → кнопка буквы) — подсветка остаётся.
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        if (st.current.focus !== wallId) return;
        st.current.focus = null;
        sync();
      },
      reset() {
        st.current.pointer = null;
        st.current.focus = null;
        sync();
      },
    };
  }, []);
  // Другая комната или панель закрыта, пока указатель над строкой, — снять подсветку.
  useEffect(() => () => hl.reset(), [hl, roomId]);
  return hl;
}

type WallHover = ReturnType<typeof useWallHover>;

/** Выделить стену на плане (как клик по ней). */
const selectWall = (roomId: string, wallId: string) => {
  const s = useAppStore.getState();
  if (!(s.selection?.type === "wall" && s.selection.wallId === wallId)) s.select({ type: "wall", roomId, wallId });
};

const SizesSection = memo(function SizesSection({ room }: { room: Room }) {
  const walls = useWalls();
  const selectedWallId = useAppStore((s) => (s.selection?.type === "wall" ? s.selection.wallId : null));
  const hl = useWallHover(room.id);
  const isRect = room.shape === "rect" && walls.length === 4;

  return (
    <Section
      title="Размеры"
      subtitle={isRect ? "Длина и ширина комнаты по полу" : `${plural(walls.length, ["стена", "стены", "стен"])} — буквы как на плане`}
    >
      {isRect ? (
        <div className="pn-grid2">
          <WallField
            wall={walls[0]}
            label="Длина (стена A)"
            selected={selectedWallId === walls[0].id}
            hl={hl}
          />
          <WallField
            wall={walls[1]}
            label="Ширина (стена B)"
            selected={selectedWallId === walls[1].id}
            hl={hl}
          />
        </div>
      ) : (
        <div className="pn-walls">
          {walls.map((w) => (
            <WallRow key={w.id} wall={w} roomId={room.id} selected={selectedWallId === w.id} hl={hl} />
          ))}
        </div>
      )}
      <p className="pn-hint">
        <Icon name="ruler" size={14} />
        <span>
          Меряйте по полу от угла до угла. При изменении стены сдвигается соседняя — комната остаётся
          замкнутой.
        </span>
      </p>
      <Disclosure
        title="Потолок и стены"
        right={`${formatLength(room.height)} · ${formatLength(room.wallThickness, "cm")}`}
      >
        <div className="pn-grid2">
          <LengthField
            label="Высота потолка"
            value={room.height}
            unit="m"
            min={ROOM_HEIGHT_RANGE.min}
            max={ROOM_HEIGHT_RANGE.max}
            step={0.05}
            onChange={(v) => useAppStore.getState().updateRoom({ height: v })}
          />
          <LengthField
            label="Толщина стен"
            value={room.wallThickness}
            unit="cm"
            digits={0}
            min={WALL_THICKNESS_RANGE.min}
            max={WALL_THICKNESS_RANGE.max}
            onChange={(v) => useAppStore.getState().updateRoom({ wallThickness: v })}
          />
        </div>
        <p className="pn-note">
          Высота нужна для площади стен и 3D. Толщина стен — для откосов проёмов: плинтус всегда
          считается по внутренней стороне.
        </p>
      </Disclosure>
    </Section>
  );
});

const WallField = memo(function WallField({
  wall,
  label,
  selected,
  hl,
}: {
  wall: Wall;
  label: string;
  selected: boolean;
  hl: WallHover;
}) {
  return (
    <div
      className={`pn-wallfield${selected ? " is-selected" : ""}`}
      onPointerEnter={(e) => hl.enter(wall.id, e)}
      onPointerLeave={(e) => hl.leave(wall.id, e)}
      onFocus={() => hl.focus(wall.id)}
      onBlur={(e) => hl.blur(wall.id, e)}
    >
      <LengthField
        label={label}
        value={wall.length}
        unit="m"
        min={MIN_WALL}
        max={MAX_WALL_INPUT}
        onChange={(v) => commitWallLength(wall.id, v)}
      />
    </div>
  );
});

const WallRow = memo(function WallRow({
  wall,
  roomId,
  selected,
  hl,
}: {
  wall: Wall;
  roomId: string;
  selected: boolean;
  hl: WallHover;
}) {
  return (
    <div
      className={`pn-wallrow${selected ? " is-selected" : ""}`}
      onPointerEnter={(e) => hl.enter(wall.id, e)}
      onPointerLeave={(e) => hl.leave(wall.id, e)}
      onFocus={() => hl.focus(wall.id)}
      onBlur={(e) => hl.blur(wall.id, e)}
    >
      {/* Буква — быстрый выбор стены мышью; с клавиатуры стену выбирают на плане,
          поэтому кнопка не добавляет лишнюю остановку Tab в списке стен. */}
      <button
        type="button"
        className="pn-wallrow__badge"
        tabIndex={-1}
        aria-label={`Выделить стену ${wall.label} на плане`}
        title={selected ? `Стена ${wall.label} выделена на плане` : `Выделить стену ${wall.label} на плане`}
        onClick={() => selectWall(roomId, wall.id)}
      >
        {wall.label}
      </button>
      <LengthField
        className="pn-wallrow__field"
        ariaLabel={`Длина стены ${wall.label}`}
        value={wall.length}
        unit="m"
        min={MIN_WALL}
        max={MAX_WALL_INPUT}
        onChange={(v) => commitWallLength(wall.id, v)}
      />
    </div>
  );
});

/* ----------------------------- Сводка ----------------------------- */

const RoomSummary = memo(function RoomSummary() {
  const m = useRoomMetrics();
  return (
    <Section title="Сводка">
      <div className="pn-metrics">
        <Metric label="Площадь пола" value={formatArea(m.floorArea, 1)} />
        <Metric label="Периметр" value={formatLength(m.perimeter)} />
        <Metric label="Объём" value={formatVolume(m.volume)} />
        <Metric
          label="Стены без проёмов"
          value={formatArea(m.wallAreaNet, 1)}
          title="Площадь стен за вычетом дверей и окон — пригодится для краски и обоев"
        />
      </div>
    </Section>
  );
});

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="pn-metric" title={title}>
      <span className="pn-metric__label">{label}</span>
      <span className="pn-metric__value num">{value}</span>
    </div>
  );
}
