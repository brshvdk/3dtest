/**
 * Шаг 2 · Проёмы: добавление дверей/окон/проёмов/балконов/мебели, список
 * проёмов комнаты с влиянием на плинтус и инспектор выделенного проёма
 * (стандартные размеры, положение на стене, параметры вида).
 */
import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  CASING_INSET,
  DEFAULT_CASING,
  DOOR_FRAME,
  OPENING_KIND_META,
  getPreset,
  getPresets,
  isFloorLevelWindow,
  skirtingBlock,
  wrapsReveals,
} from "../domain/openings";
import { MIN_OPENING_WIDTH } from "../domain/roomEdit";
import type { RoomSkirtingResult } from "../domain/skirtingCalc";
import type { Opening, OpeningKind, Room } from "../domain/types";
import { formatLength } from "../domain/units";
import { useActiveRoom, useRoomProduct, useRoomResult, useWalls } from "../state/hooks";
import { useAppStore } from "../state/store";
import {
  Badge,
  Button,
  Callout,
  Field,
  Icon,
  LengthField,
  Section,
  Segmented,
  Select,
  Switch,
  TextField,
  type IconName,
} from "../ui/kit";
import { scrollBehavior } from "./motion";
import { notify } from "./notify";
import "./panels.css";

const KIND_ICON: Record<OpeningKind, IconName> = {
  door: "door",
  window: "window",
  passage: "passage",
  balcony: "balcony",
  furniture: "furniture",
};

const KIND_ORDER: OpeningKind[] = ["door", "window", "passage", "balcony", "furniture"];

/** Подписи вида в инспекторе. */
const KIND_TITLE: Record<OpeningKind, string> = {
  door: "Дверь",
  window: "Окно",
  passage: "Проём или арка",
  balcony: "Балконный блок",
  furniture: "Мебель — участок без плинтуса",
};

/** Короткое имя для строки списка: «Балкон 200×210 см» помещается рядом с бейджем. */
const KIND_SHORT: Record<OpeningKind, string> = {
  door: "Дверь",
  window: "Окно",
  passage: "Проём",
  balcony: "Балкон",
  furniture: "Мебель",
};

/** «Дверь 87×207 см», «Арка 90×210 см», «Кухня 240×90 см» */
function openingTitle(o: Opening): string {
  const name =
    o.kind === "furniture"
      ? o.label.trim() || KIND_SHORT.furniture
      : o.kind === "passage" && o.arch
        ? "Арка"
        : KIND_SHORT[o.kind];
  // Мебель — длина × глубина, как в итоге и предупреждениях (domain describeOpening).
  if (o.kind === "furniture" && o.depth > 0) return `${name} ${sizeLabel(o.width, o.depth)}`;
  return `${name} ${sizeLabel(o.width, o.height)}`;
}

/** «Не хватает места для …» */
const KIND_GENITIVE: Record<OpeningKind, string> = {
  door: "двери",
  window: "окна",
  passage: "проёма",
  balcony: "балконного блока",
  furniture: "мебели",
};

const CUSTOM_PRESET = "__custom";

const getActiveRoom = (): Room => {
  const s = useAppStore.getState();
  return s.project.rooms.find((r) => r.id === s.activeRoomId) ?? s.project.rooms[0];
};

/** «87×207 см» */
const sizeLabel = (w: number, h: number) => `${Math.round(w * 100)}×${Math.round(h * 100)} см`;
/** Подсказка пресета, если в ней есть что-то кроме размера («900×2100 мм», «блок 2000×2100 мм» — нет). */
function presetNote(hint: string): string | undefined {
  const rest = hint.replace(/\d+(×\d+)?\s*мм/g, "").replace(/^\s*блок\b/i, "");
  return /[а-яё]{3,}/i.test(rest) ? hint.charAt(0).toUpperCase() + hint.slice(1) : undefined;
}

/** «95 см» */
const cm = (m: number) => formatLength(m, "cm");
/** «0,95 м» */
const meters = (m: number) => formatLength(m, "m");

interface Impact {
  /** м, на сколько прервался плинтус (без двойного счёта перекрытий). */
  deduct: number;
  /** м, добавлено на откосы. */
  reveal: number;
}

function impactsOf(result: RoomSkirtingResult | undefined): Map<string, Impact> {
  const map = new Map<string, Impact>();
  if (!result) return map;
  for (const d of result.deductions) {
    const cur = map.get(d.openingId) ?? { deduct: 0, reveal: 0 };
    map.set(d.openingId, { ...cur, deduct: cur.deduct + d.length });
  }
  for (const r of result.reveals) {
    const cur = map.get(r.openingId) ?? { deduct: 0, reveal: 0 };
    map.set(r.openingId, { ...cur, reveal: cur.reveal + r.length });
  }
  return map;
}

/* ------------------------------------------------------------------ */

export function OpeningsPanel() {
  const room = useActiveRoom();
  const walls = useWalls();
  const result = useRoomResult();
  const selectedOpeningId = useAppStore((s) => (s.selection?.type === "opening" ? s.selection.openingId : null));
  const selectedWallId = useAppStore((s) => (s.selection?.type === "wall" ? s.selection.wallId : null));

  const impacts = useMemo(() => impactsOf(result), [result]);
  const wallById = useMemo(() => new Map(walls.map((w) => [w.id, w])), [walls]);
  const sorted = useMemo(() => {
    const idx = (o: Opening) => wallById.get(o.wallId)?.index ?? 0;
    return [...room.openings].sort((a, b) => idx(a) - idx(b) || a.offset - b.offset);
  }, [room.openings, wallById]);

  const targetWall = selectedWallId ? wallById.get(selectedWallId) ?? null : null;
  const counted = room.skirtingEnabled && !!result;

  return (
    <div className="pn">
      <AddSection
        targetWallId={targetWall?.id ?? null}
        targetLabel={targetWall?.label ?? ""}
        targetLength={targetWall?.length ?? 0}
      />

      {!room.skirtingEnabled ? (
        <Callout tone="warning">
          Комната «{room.name}» не учитывается в расчёте плинтуса.{" "}
          <button
            type="button"
            className="pn-link"
            onClick={() => useAppStore.getState().updateRoom({ skirtingEnabled: true })}
          >
            Учитывать
          </button>
        </Callout>
      ) : null}

      <Section
        title="В этой комнате"
        actions={sorted.length ? <Badge>{sorted.length}</Badge> : undefined}
        subtitle={
          sorted.length
            ? selectedOpeningId
              ? "Размер и положение — в карточке проёма"
              : "Нажмите на проём, чтобы настроить его"
            : undefined
        }
      >
        {sorted.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="pn-oplist" role="list" aria-label="Проёмы комнаты">
            {sorted.map((o) => (
              <OpeningItem
                key={o.id}
                opening={o}
                wallLabel={wallById.get(o.wallId)?.label ?? ""}
                deduct={impacts.get(o.id)?.deduct ?? 0}
                reveal={impacts.get(o.id)?.reveal ?? 0}
                counted={counted}
                selected={o.id === selectedOpeningId}
                roomId={room.id}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* --------------------------- Добавление --------------------------- */

const AddSection = memo(function AddSection({
  targetWallId,
  targetLabel,
  targetLength,
}: {
  targetWallId: string | null;
  targetLabel: string;
  targetLength: number;
}) {
  const targetWall = targetWallId ? { id: targetWallId, label: targetLabel, length: targetLength } : null;
  const add = (kind: OpeningKind) => {
    const s = useAppStore.getState();
    const id = s.addOpening(kind, targetWall ? { wallId: targetWall.id } : undefined);
    if (!id) {
      notify(
        targetWall
          ? `На стене ${targetWall.label} не хватает места для ${KIND_GENITIVE[kind]}`
          : `Не нашлось свободного места для ${KIND_GENITIVE[kind]} — удлините стены или сдвиньте другие проёмы`,
        "warning",
      );
    }
  };

  return (
    <Section step={2} title="Проёмы" subtitle="Двери, окна и мебель — плинтус учтёт их сам">
      <div className="pn-addgrid">
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            className={`pn-add pn-kind--${k}`}
            onClick={() => add(k)}
            title={OPENING_KIND_META[k].hint}
          >
            <span className="pn-add__icon">
              <Icon name={KIND_ICON[k]} size={20} />
            </span>
            <span className="pn-add__label">{OPENING_KIND_META[k].addLabel}</span>
          </button>
        ))}
      </div>
      <div className="pn-target">
        {targetWall ? (
          <>
            <span className="pn-target__badge">{targetWall.label}</span>
            <span>
              Добавим на стену {targetWall.label} · {meters(targetWall.length)}
            </span>
            <button
              type="button"
              className="pn-link pn-target__reset"
              onClick={() => useAppStore.getState().select(null)}
            >
              Любая стена
            </button>
          </>
        ) : (
          <>
            <Icon name="info" size={14} />
            <span>Поставим на подходящую стену. Чтобы выбрать стену — нажмите на неё на плане.</span>
          </>
        )}
      </div>
    </Section>
  );
});

function EmptyState() {
  return (
    <div className="pn-empty">
      <div className="pn-empty__art" aria-hidden>
        <Icon name="door" size={26} />
      </div>
      <div className="pn-empty__title">Пока нет ни одного проёма</div>
      <p className="pn-empty__text">
        Добавьте двери — их ширина вычитается из длины плинтуса. Окна обычно выше плинтуса и на расчёт
        не влияют, а под кухней и шкафами плинтус не нужен.
      </p>
    </div>
  );
}

/* ----------------------------- Список ----------------------------- */

/** Пропсы — примитивы и ссылка на проём: при перетаскивании на плане перерисовывается только изменённый. */
interface ItemProps {
  opening: Opening;
  wallLabel: string;
  deduct: number;
  reveal: number;
  counted: boolean;
  selected: boolean;
  roomId: string;
}

const OpeningItem = memo(function OpeningItem({
  opening: o,
  wallLabel,
  deduct,
  reveal,
  counted,
  selected,
  roomId,
}: ItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Выделили на плане — показываем карточку в панели.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  }, [selected]);

  const toggle = () =>
    useAppStore.getState().select(selected ? null : { type: "opening", roomId, openingId: o.id });

  const preset = getPreset(o.presetId);
  const title = openingTitle(o);

  return (
    <div ref={ref} role="listitem" className={`pn-op${selected ? " is-open" : ""}`}>
      <button
        type="button"
        className="pn-op__head"
        aria-expanded={selected}
        onClick={toggle}
        title={preset ? `${title} · ${preset.name}` : title}
      >
        <span className={`pn-op__icon pn-kind--${o.kind}`}>
          <Icon name={KIND_ICON[o.kind]} size={18} />
        </span>
        <span className="pn-op__titles">
          <span className="pn-op__title">{title}</span>
          <span className="pn-op__line">
            <span className="pn-op__sub">
              {wallLabel ? `Стена ${wallLabel}` : "Стена не найдена"}
              {/* Название пресета — только если хватает ширины (см. panels.css), без обрезки. */}
              {preset ? <span className="pn-op__preset"> · {preset.name}</span> : null}
            </span>
            {counted ? <ImpactBadges deduct={deduct} reveal={reveal} /> : null}
          </span>
        </span>
        <Icon name="chevron-down" size={16} className="pn-op__chevron" />
      </button>
      {selected ? <OpeningInspector opening={o} deduct={deduct} reveal={reveal} counted={counted} /> : null}
    </div>
  );
});

function ImpactBadges({ deduct, reveal }: { deduct: number; reveal: number }) {
  const impact: Impact = { deduct, reveal };
  if (impact.deduct < 0.0005 && impact.reveal < 0.0005) {
    return (
      <span className="pn-op__impact">
        <Badge title="Плинтус проходит под этим объектом без разрыва">не влияет</Badge>
      </span>
    );
  }
  return (
    <span className="pn-op__impact">
      {impact.deduct >= 0.0005 ? (
        <Badge tone="accent" title={`Плинтус прерывается: −${meters(impact.deduct)} плинтуса`}>
          −{meters(impact.deduct)}
        </Badge>
      ) : null}
      {impact.reveal >= 0.0005 ? (
        <Badge tone="success" title={`Плинтус заходит в откосы: +${meters(impact.reveal)}`}>
          +{meters(impact.reveal)}
        </Badge>
      ) : null}
    </span>
  );
}

/* ---------------------------- Инспектор --------------------------- */

function OpeningInspector({
  opening: o,
  deduct,
  reveal,
  counted,
}: {
  opening: Opening;
  deduct: number;
  reveal: number;
  counted: boolean;
}) {
  const walls = useWalls();
  const wall = walls.find((w) => w.id === o.wallId);
  const roomHeight = useAppStore((s) => (s.project.rooms.find((r) => r.id === s.activeRoomId) ?? s.project.rooms[0]).height);
  const skirtingHeight = useRoomProduct().height;
  const impact: Impact = { deduct, reveal };
  const id = o.id;
  const update = (patch: Partial<Opening>) => useAppStore.getState().updateOpening(id, patch);
  const L = wall?.length ?? o.offset + o.width;
  const right = Math.max(0, L - o.offset - o.width);
  const move = (wallId: string, offset: number) => useAppStore.getState().moveOpening(id, wallId, offset);

  const presets = getPresets(o.kind);
  const presetOptions = [
    ...(o.presetId ? [] : [{ value: CUSTOM_PRESET, label: `Свой размер · ${sizeLabel(o.width, o.height)}` }]),
    ...presets.map((p) => ({ value: p.id, label: `${p.name} · ${sizeLabel(p.width, p.height)}` })),
  ];
  const preset = getPreset(o.presetId);

  const changeWall = (wallId: string) => {
    const w = walls.find((x) => x.id === wallId);
    if (!w) return;
    move(wallId, Math.max(0, (w.length - o.width) / 2));
  };

  const duplicate = () => {
    const before = getActiveRoom();
    useAppStore.getState().duplicateOpening(id);
    if (getActiveRoom() === before) notify("Для копии не нашлось свободного места", "warning");
  };
  const remove = () => {
    useAppStore.getState().removeOpening(id);
    notify("Проём удалён — можно отменить", "info");
  };

  const isFurniture = o.kind === "furniture";
  const isWindow = o.kind === "window";

  return (
    <div className="pn-insp">
      <Field label={<>Тип · <span className="pn-insp__kind">{KIND_TITLE[o.kind]}</span></>}>
        <Segmented<OpeningKind>
          value={o.kind}
          block
          ariaLabel="Тип проёма"
          onChange={(k) => update({ kind: k })}
          options={KIND_ORDER.map((k) => ({
            value: k,
            label: "",
            icon: KIND_ICON[k],
            title: OPENING_KIND_META[k].addLabel,
          }))}
        />
      </Field>

      <Select
        label="Стандартный размер"
        value={o.presetId ?? CUSTOM_PRESET}
        options={presetOptions}
        onChange={(v) => {
          if (v !== CUSTOM_PRESET) update({ presetId: v });
        }}
        hint={
          preset
            ? presetNote(preset.hint)
            : "Не совпадает со стандартным — выберите размер из списка или оставьте свой"
        }
      />

      <div className={isWindow ? "pn-grid3" : "pn-grid2"}>
        <LengthField
          label={isFurniture ? "Длина" : "Ширина"}
          value={o.width}
          unit="cm"
          digits={1}
          min={MIN_OPENING_WIDTH}
          max={L}
          onChange={(v) => update({ width: v })}
        />
        <LengthField
          label="Высота"
          value={o.height}
          unit="cm"
          digits={1}
          min={0.05}
          max={Math.max(roomHeight, o.height)}
          onChange={(v) => update({ height: v })}
        />
        {isWindow ? (
          <LengthField
            label="Подоконник"
            value={o.elevation}
            unit="cm"
            digits={1}
            min={0}
            max={Math.max(0, roomHeight - 0.1)}
            onChange={(v) => update({ elevation: v })}
          />
        ) : null}
      </div>
      {o.kind === "door" ? (
        <p className="pn-note">
          Ширина проёма в стене. Подойдёт полотно ≈ {cm(Math.max(0.2, o.width - 2 * DOOR_FRAME))} — проём шире на 7 см из-за коробки.
        </p>
      ) : null}
      {isWindow ? (
        <p className="pn-note">
          {isFloorLevelWindow(o, skirtingHeight)
            ? `Подоконник ниже верха плинтуса (${cm(skirtingHeight)}) — окно в пол, плинтус под ним прерывается.`
            : "Высота подоконника — от пола до низа окна."}
        </p>
      ) : null}

      {/* Положение на стене */}
      <div className="pn-insp__group">
        <div className="pn-insp__group-head">
          <span className="pn-insp__group-title">Положение</span>
          <Button
            size="sm"
            variant="ghost"
            icon="center"
            onClick={() => move(o.wallId, Math.max(0, (L - o.width) / 2))}
            disabled={Math.abs(o.offset - right) < 0.005}
            title="Поставить по центру стены"
          >
            По центру
          </Button>
        </div>
        <Select
          ariaLabel="Стена"
          value={o.wallId}
          options={walls.map((w) => ({ value: w.id, label: `Стена ${w.label} · ${meters(w.length)}` }))}
          onChange={changeWall}
        />
        <div className="pn-grid2">
          <LengthField
            label="От левого угла"
            value={o.offset}
            unit="cm"
            digits={1}
            min={0}
            max={Math.max(0, L - o.width)}
            onChange={(v) => move(o.wallId, v)}
          />
          <LengthField
            label="До правого угла"
            value={right}
            unit="cm"
            digits={1}
            min={0}
            max={Math.max(0, L - o.width)}
            onChange={(v) => move(o.wallId, L - o.width - v)}
          />
        </div>
        <p className="pn-note">
          Лево и право — если стоять в комнате лицом к стене. Считаем до края проёма.
        </p>
      </div>

      <KindOptions o={o} update={update} wallThickness={wall?.thickness ?? 0} skirtingHeight={skirtingHeight} />

      <ImpactLine o={o} impact={impact} counted={counted} skirtingHeight={skirtingHeight} />

      <div className="pn-insp__actions">
        <Button size="sm" icon="copy" onClick={duplicate}>
          Дублировать
        </Button>
        <Button size="sm" variant="danger" icon="trash" onClick={remove}>
          Удалить
        </Button>
      </div>
    </div>
  );
}

/* ----------------------- Параметры по виду ------------------------ */

function KindOptions({
  o,
  update,
  wallThickness,
  skirtingHeight,
}: {
  o: Opening;
  update: (patch: Partial<Opening>) => void;
  wallThickness: number;
  skirtingHeight: number;
}) {
  switch (o.kind) {
    case "door":
      return (
        <div className="pn-insp__group">
          <div className="pn-insp__group-title">Дверь</div>
          <OptionRow label="Петли">
            <Segmented<"left" | "right">
              value={o.hinge}
              block
              size="sm"
              ariaLabel="Сторона петель"
              onChange={(v) => update({ hinge: v })}
              options={[
                { value: "left", label: "Слева" },
                { value: "right", label: "Справа" },
              ]}
            />
          </OptionRow>
          <OptionRow label="Открывается">
            <Segmented<"in" | "out">
              value={o.swing}
              block
              size="sm"
              ariaLabel="Куда открывается дверь"
              onChange={(v) => update({ swing: v })}
              options={[
                { value: "in", label: "Внутрь" },
                { value: "out", label: "Наружу" },
              ]}
            />
          </OptionRow>
          <OptionRow label="Створки">
            <Segmented<"1" | "2">
              value={o.leaves === 2 ? "2" : "1"}
              block
              size="sm"
              ariaLabel="Число створок"
              onChange={(v) => update({ leaves: v === "2" ? 2 : 1 })}
              options={[
                { value: "1", label: "Одна" },
                { value: "2", label: "Две" },
              ]}
            />
          </OptionRow>
          <CasingControl o={o} update={update} label="Наличник" />
        </div>
      );
    case "passage": {
      const casingOn = o.casing > 0;
      return (
        <div className="pn-insp__group">
          <div className="pn-insp__group-title">Проём</div>
          <Switch
            checked={wrapsReveals(o)}
            disabled={casingOn}
            onChange={(v) => update({ wrapReveals: v })}
            label="Завести плинтус в откосы"
            hint={
              casingOn
                ? "С наличником плинтус упирается в него, откосы не обходит"
                : `Плинтус огибает стены проёма: +2\u00A0×\u00A0${cm(wallThickness)}`
            }
          />
          <CasingControl o={o} update={update} label="Наличник (портал)" />
          <Switch
            checked={o.arch}
            onChange={(v) => update({ arch: v })}
            label="Арка"
            hint="Полукруглый верх — только для вида, на плинтус не влияет"
          />
        </div>
      );
    }
    case "balcony":
      return (
        <div className="pn-insp__group">
          <div className="pn-insp__group-title">Балконный блок</div>
          <OptionRow label="Дверь">
            <Segmented<"left" | "right">
              value={o.balconyDoorSide}
              block
              size="sm"
              ariaLabel="Сторона балконной двери"
              onChange={(v) => update({ balconyDoorSide: v })}
              options={[
                { value: "left", label: "Слева" },
                { value: "right", label: "Справа" },
              ]}
            />
          </OptionRow>
          <div className="pn-grid2">
            <LengthField
              label="Ширина двери"
              value={o.balconyDoorWidth}
              unit="cm"
              digits={1}
              min={0.4}
              max={Math.max(0.4, o.width - 0.2)}
              onChange={(v) => update({ balconyDoorWidth: v })}
            />
            <LengthField
              label="Подоконник окна"
              value={o.balconySillHeight}
              unit="cm"
              digits={1}
              min={0}
              max={Math.max(0, o.height - 0.1)}
              onChange={(v) => update({ balconySillHeight: v })}
            />
          </div>
          <p className="pn-note">
            {o.balconySillHeight < skirtingHeight + 0.005
              ? `Подоконник ниже верха плинтуса (${cm(skirtingHeight)}) — плинтус прерывается под всем блоком.`
              : "Под окном плинтус идёт как обычно, под дверью — прерывается."}
          </p>
        </div>
      );
    case "furniture":
      return (
        <div className="pn-insp__group">
          <div className="pn-insp__group-title">Мебель</div>
          <div className="pn-grid2">
            <TextField
              label="Подпись"
              value={o.label}
              onChange={(v) => update({ label: v })}
              placeholder="Например, Кухня"
              maxLength={40}
            />
            <LengthField
              label="Глубина"
              value={o.depth}
              unit="cm"
              digits={1}
              min={0.1}
              max={1.5}
              onChange={(v) => update({ depth: v })}
            />
          </div>
          <p className="pn-note">Вдоль мебели плинтус не нужен — например, у кухни свой цоколь.</p>
        </div>
      );
    case "window":
      return null;
  }
}

function OptionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pn-optrow">
      <span className="pn-optrow__label">{label}</span>
      <div className="pn-optrow__control">{children}</div>
    </div>
  );
}

function CasingControl({
  o,
  update,
  label,
}: {
  o: Opening;
  update: (patch: Partial<Opening>) => void;
  label: string;
}) {
  const on = o.casing > 0;
  return (
    <div className="pn-casing">
      <Switch
        checked={on}
        onChange={(v) => update({ casing: v ? DEFAULT_CASING : 0 })}
        label={label}
        hint={on ? "Плинтус упирается в наличник" : "Плинтус доходит до края проёма"}
      />
      {on ? (
        <LengthField
          className="pn-casing__field"
          ariaLabel="Ширина наличника"
          value={o.casing}
          unit="mm"
          min={CASING_INSET + 0.005}
          max={0.25}
          step={5}
          onChange={(v) => update({ casing: v })}
        />
      ) : null}
    </div>
  );
}

/* ------------------------ Итог по плинтусу ------------------------ */

function ImpactLine({
  o,
  impact,
  counted,
  skirtingHeight,
}: {
  o: Opening;
  impact: Impact;
  counted: boolean;
  skirtingHeight: number;
}) {
  let text: string;
  let tone: "neutral" | "accent" = "accent";
  if (!counted) {
    text = "Комната не учитывается в расчёте плинтуса";
    tone = "neutral";
  } else if (!skirtingBlock(o, skirtingHeight)) {
    text =
      o.kind === "window"
        ? "Не влияет на плинтус — окно выше плинтуса"
        : "Не влияет на плинтус";
    tone = "neutral";
  } else if (impact.deduct < 0.0005) {
    text = "Не влияет: этот участок уже учтён соседним проёмом";
    tone = "neutral";
  } else {
    const len = cm(impact.deduct);
    switch (o.kind) {
      case "furniture":
        text = `Без плинтуса на ${len} — вдоль мебели`;
        break;
      case "balcony":
        text =
          o.balconySillHeight < skirtingHeight + 0.005
            ? `Плинтус прерывается на ${len} — подоконник ниже плинтуса, под всем блоком`
            : `Плинтус прерывается на ${len} — у балконной двери`;
        break;
      case "window":
        text = `Плинтус прерывается на ${len} — окно в пол`;
        break;
      default:
        text = `Плинтус прерывается на ${len}${o.casing > 0 ? " вместе с наличниками" : ""}`;
    }
    if (impact.reveal >= 0.0005) text += ` · +${cm(impact.reveal)} в откосы`;
  }
  return (
    <div className={`pn-impact pn-impact--${tone}`}>
      <Icon name={tone === "accent" ? "skirting" : "check"} size={16} />
      <span>{text}</span>
    </div>
  );
}
