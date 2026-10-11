/**
 * Шаг 3 · Плинтус: каталог (по группам материалов), выбор для проекта или
 * для отдельной комнаты, параметры выбранного (длина планки, цвет, углы,
 * цены, крепёж) и параметры расчёта (запас, минимальный кусок, пропил).
 */
import { memo, useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  CUSTOM_PRODUCT_ID,
  MATERIAL_META,
  SKIRTING_CATALOG,
  getColorName,
  hasOverride,
  resolveProduct,
} from "../domain/skirtingCatalog";
import type {
  AccessoryPrices,
  CornerMethod,
  SkirtingMaterial,
  SkirtingProduct,
  SkirtingSettings,
} from "../domain/types";
import { formatLength, formatMoney, formatNumber, plural } from "../domain/units";
import { useRoomProduct } from "../state/hooks";
import { useAppStore, type AppState, type ProductOverridePatch } from "../state/store";
import {
  Badge,
  Button,
  Callout,
  ColorSwatches,
  Disclosure,
  Field,
  Icon,
  LengthField,
  NumberField,
  Section,
  Segmented,
  Switch,
  TextField,
  rovingFocusIndex,
  rovingKeyDown,
} from "../ui/kit";
import { scrollBehavior } from "./motion";
import { ProfileIcon } from "./ProfileIcon";
import { rovingFocusKeyDown } from "./roving";
import "./panels.css";

/** Общий масштаб иконок каталога: 120 мм — вся высота. */
const CATALOG_SCALE_MM = 120;
const RESERVE_PRESETS = [0, 5, 10, 15];
const MATERIAL_ORDER = Object.keys(MATERIAL_META) as SkirtingMaterial[];

const activeRoomOf = (s: AppState) => s.project.rooms.find((r) => r.id === s.activeRoomId) ?? s.project.rooms[0];

/** «Плинтус ПВХ 55 мм…» → «ПВХ 55 мм…» */
function displayName(p: SkirtingProduct): string {
  const s = p.name.replace(/^Плинтус\s+/i, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const lengthLabel = (m: number) => formatLength(m, "m", 2, { trim: true });

const CORNER_HINT: Record<CornerMethod, string> = {
  fittings:
    "Готовые уголки и заглушки закрывают углы и торцы: планки режутся под прямым углом, монтаж проще.",
  miter:
    "Концы планок срезаются под 45° и стыкуются без накладок. Выглядит аккуратнее, но понадобятся стусло или торцовочная пила.",
};

/**
 * Пояснение к способу стыковки углов (керамику режут не пилой). У ПВХ с
 * кабель-каналом запил заменяет только уголки: торцы закрывают заглушками,
 * стыки по длине — соединителями (domain/estimate, keepsEndFittings).
 */
function cornerHint(p: SkirtingProduct): string {
  if (p.cornerMethod === "miter" && p.material === "ceramic") {
    return "Концы плитки срезаются под 45° плиткорезом или болгаркой и стыкуются без накладок.";
  }
  if (p.cornerMethod === "miter" && p.cableChannel) {
    return "Концы планок срезаются под 45°: не нужны угловые элементы; заглушки и соединители остаются. Понадобятся стусло или торцовочная пила.";
  }
  return CORNER_HINT[p.cornerMethod];
}

/** Подсказка к варианту «Запил 45°». */
const miterTitle = (p: SkirtingProduct): string =>
  p.cableChannel ? "Без угловых элементов; заглушки и соединители остаются" : "Стыковка без уголков";

/* ------------------------------------------------------------------ */

export function SkirtingPanel() {
  const product = useRoomProduct();
  const excludedRoom = useAppStore((s) => {
    const r = activeRoomOf(s);
    return r.skirtingEnabled ? null : r.name;
  });
  return (
    <div className="pn">
      {excludedRoom !== null ? (
        <Callout tone="warning">
          Комната «{excludedRoom}» не учитывается в расчёте плинтуса.{" "}
          <button
            type="button"
            className="pn-link"
            onClick={() => useAppStore.getState().updateRoom({ skirtingEnabled: true })}
          >
            Учитывать
          </button>
        </Callout>
      ) : null}
      <CatalogSection selectedId={product.id} />
      <ProductSection product={product} />
      <CalcSettings />
    </div>
  );
}

/* ----------------------------- Каталог ---------------------------- */

const CatalogSection = memo(function CatalogSection({ selectedId }: { selectedId: string }) {
  const overrides = useAppStore((s) => s.project.productOverrides);
  const roomsCount = useAppStore((s) => s.project.rooms.length);
  const projectProductId = useAppStore((s) => s.project.skirting.productId);
  const roomName = useAppStore((s) => activeRoomOf(s).name);
  const ownProduct = useAppStore((s) => activeRoomOf(s).productId !== null);
  const showScope = roomsCount > 1 || ownProduct;
  // Каталог длинный: по умолчанию виден только выбранный плинтус, остальные — по кнопке.
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  const groups = useMemo(() => {
    const resolved = SKIRTING_CATALOG.map((p) => resolveProduct(p.id, overrides));
    const out: Array<{ key: string; title: string; hint: string; items: SkirtingProduct[] }> = [];
    for (const m of MATERIAL_ORDER) {
      const items = resolved.filter((p) => p.material === m && p.id !== CUSTOM_PRODUCT_ID);
      if (items.length) out.push({ key: m, title: MATERIAL_META[m].name, hint: MATERIAL_META[m].description, items });
    }
    const custom = resolved.find((p) => p.id === CUSTOM_PRODUCT_ID);
    if (custom) {
      out.push({ key: "custom", title: "Свой вариант", hint: "Нет нужного? Задайте размеры и цены сами.", items: [custom] });
    }
    return out;
  }, [overrides]);

  const total = SKIRTING_CATALOG.length;
  const selected = useMemo(
    () => groups.flatMap((g) => g.items).find((p) => p.id === selectedId) ?? resolveProduct(selectedId, overrides),
    [groups, selectedId, overrides],
  );
  const projectProductName = resolveProduct(projectProductId, overrides).shortName;
  const tabStopId = useMemo(() => {
    const all = groups.flatMap((g) => g.items);
    return all[rovingFocusIndex(all, (p) => p.id === selectedId)]?.id ?? null;
  }, [groups, selectedId]);

  /** Выбор из списка: меняет плинтус комнаты (если у неё свой) или проекта и сворачивает список. */
  const pick = useCallback((id: string) => {
    const s = useAppStore.getState();
    const active = s.project.rooms.find((r) => r.id === s.activeRoomId);
    if (active?.productId) s.updateRoom({ productId: id });
    else s.setDefaultProduct(id);
    setExpanded(false);
    // Список схлопнулся: возвращаем выбранную карточку в поле зрения, а фокус
    // (кнопка выбора исчезла) — на кнопку списка, чтобы не терять место с клавиатуры.
    requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
      if (!document.activeElement || document.activeElement === document.body) {
        moreRef.current?.focus({ preventScroll: true });
      }
    });
  }, []);
  const openList = useCallback(() => setExpanded(true), []);

  const setScope = (v: "project" | "own") => {
    const s = useAppStore.getState();
    if (v === "own") s.updateRoom({ productId: selectedId });
    else s.updateRoom({ productId: null });
  };

  return (
    <Section step={3} title="Плинтус" subtitle="Выберите плинтус — количество и цена пересчитаются сразу">
      {showScope ? (
        <div className="pn-scope">
          <div className="pn-scope__row">
            <span className="pn-scope__label">
              Для комнаты <b>«{roomName}»</b>
            </span>
            <Segmented<"project" | "own">
              size="sm"
              value={ownProduct ? "own" : "project"}
              ariaLabel="Плинтус комнаты"
              onChange={setScope}
              options={[
                { value: "project", label: "Как в проекте" },
                { value: "own", label: "Свой" },
              ]}
            />
          </div>
          <p className="pn-note">
            {ownProduct
              ? `Выбор ниже меняет плинтус только этой комнаты. В остальных — ${projectProductName}.`
              : "Выбор ниже применяется ко всем комнатам, кроме тех, где выбран свой."}
          </p>
        </div>
      ) : null}

      <div ref={rootRef} className="pn-catalog">
        {expanded ? (
          // Один выбор на весь каталог — одна группа radio с одной остановкой Tab.
          // Стрелки только листают (выбор сворачивает список), выбирают Enter или пробелом.
          <div
            id={listId}
            className="pn-catalog__list"
            role="radiogroup"
            aria-label="Плинтус"
            onKeyDown={rovingFocusKeyDown}
          >
            {groups.map((g) => (
              <div key={g.key} className="pn-catgroup" role="group" aria-labelledby={`${listId}-${g.key}`}>
                <div id={`${listId}-${g.key}`} className="pn-catgroup__title" title={g.hint}>
                  {g.title}
                </div>
                {g.items.map((p) => (
                  <CatalogCard
                    key={p.id}
                    product={p}
                    selected={p.id === selectedId}
                    tabbable={p.id === tabStopId}
                    onPick={pick}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <CatalogCard product={selected} selected onPick={openList} summary />
        )}
        <button
          ref={moreRef}
          type="button"
          className={`pn-more${expanded ? " is-open" : ""}`}
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          onClick={() => setExpanded((v) => !v)}
        >
          <Icon name={expanded ? "chevron-down" : "list"} size={16} className="pn-more__icon" />
          <span className="pn-more__label">{expanded ? "Свернуть список" : "Выбрать другой"}</span>
          {!expanded ? (
            <span className="pn-more__count num">ещё {plural(total - 1, ["вариант", "варианта", "вариантов"])}</span>
          ) : null}
        </button>
      </div>
    </Section>
  );
});

const CatalogCard = memo(function CatalogCard({
  product: p,
  selected,
  tabbable,
  onPick,
  summary,
}: {
  product: SkirtingProduct;
  selected: boolean;
  /** Остановка Tab в группе (roving tabindex); у свёрнутой карточки не нужна. */
  tabbable?: boolean;
  onPick: (id: string) => void;
  /** Свёрнутый каталог: карточка выбранного, клик открывает список. */
  summary?: boolean;
}) {
  return (
    <button
      type="button"
      role={summary ? undefined : "radio"}
      aria-checked={summary ? undefined : selected}
      tabIndex={summary ? undefined : tabbable ? 0 : -1}
      className={`pn-prod${selected ? " is-active" : ""}${summary ? " is-summary" : ""}`}
      onClick={() => onPick(p.id)}
      title={summary ? `${p.description}\nНажмите, чтобы выбрать другой` : p.description}
    >
      <span className="pn-prod__icon">
        <ProfileIcon product={p} size={44} scaleMm={CATALOG_SCALE_MM} showLabel={false} />
      </span>
      <span className="pn-prod__body">
        {summary ? <span className="pn-prod__kicker">{groupTitle(p)}</span> : null}
        <span className="pn-prod__name">{displayName(p)}</span>
        <span className="pn-prod__info">
          <span className="pn-prod__meta num">
            {formatNumber(Math.round(p.height * 1000), 0)} мм · {lengthLabel(p.length)} · от {formatMoney(p.price)}
          </span>
          {/* Бейдж — только если свойство не названо в имени. */}
          {p.cableChannel && !/кабель/i.test(p.name) ? <Badge>кабель-канал</Badge> : null}
          {p.paintable && !/покраск/i.test(p.name) ? <Badge>под покраску</Badge> : null}
        </span>
      </span>
      <span className="pn-prod__check" aria-hidden>
        <Icon name="check" size={14} strokeWidth={2.6} />
      </span>
    </button>
  );
});

/** Группа плинтуса для подписи над выбранным: «ПВХ (пластик)», «Свой вариант». */
function groupTitle(p: SkirtingProduct): string {
  return p.id === CUSTOM_PRODUCT_ID ? "Свой вариант" : MATERIAL_META[p.material].name;
}

/* ------------------------ Параметры продукта ---------------------- */

const ProductSection = memo(function ProductSection({ product: p }: { product: SkirtingProduct }) {
  const edited = useAppStore((s) => hasOverride(p.id, s.project.productOverrides));
  const update = useCallback(
    (patch: ProductOverridePatch) => useAppStore.getState().updateProductOverride(p.id, patch),
    [p.id],
  );
  const isCustom = p.id === CUSTOM_PRODUCT_ID;

  return (
    <Section
      title={`Параметры: ${isCustom ? p.name : p.shortName}`}
      subtitle={p.description}
      actions={
        edited ? (
          <Button
            size="sm"
            variant="ghost"
            icon="undo"
            onClick={() => useAppStore.getState().resetProductOverride(p.id)}
            title="Вернуть длину, цвет и цены из каталога"
          >
            Сбросить
          </Button>
        ) : undefined
      }
    >
      <div className="pn-prodhead">
        <ProfileIcon product={p} size={64} />
        <div className="pn-prodhead__facts">
          <Fact k="Высота" v={formatLength(p.height, "mm")} />
          <Fact k="Толщина" v={formatLength(p.depth, "mm")} />
          <Fact k="Планка" v={lengthLabel(p.length)} />
        </div>
      </div>

      {isCustom ? (
        <div className="pn-insp__group">
          <TextField label="Название" value={p.name} onChange={(v) => update({ name: v })} maxLength={60} />
          <div className="pn-grid2">
            <LengthField
              label="Высота"
              value={p.height}
              unit="mm"
              min={0.01}
              max={0.5}
              onChange={(v) => update({ height: v })}
            />
            <LengthField
              label="Толщина"
              value={p.depth}
              unit="mm"
              min={0.002}
              max={0.1}
              onChange={(v) => update({ depth: v })}
            />
          </div>
        </div>
      ) : null}

      <PlankLength key={p.id} product={p} update={update} />

      <Field
        label={
          <>
            Цвет · <span className="pn-strong">{getColorName(p)}</span>
          </>
        }
      >
        <ColorSwatches value={p.color} colors={p.colors} onChange={(hex) => update({ color: hex })} />
      </Field>

      <Field label="Углы" hint={cornerHint(p)}>
        {p.cornerMethods.length > 1 ? (
          <Segmented<CornerMethod>
            block
            value={p.cornerMethod}
            ariaLabel="Как стыковать углы"
            onChange={(v) => update({ cornerMethod: v })}
            options={p.cornerMethods.map((m) => ({
              value: m,
              label: m === "fittings" ? "Фурнитура" : "Запил 45°",
              title: m === "fittings" ? "Готовые уголки, заглушки и соединители" : miterTitle(p),
            }))}
          />
        ) : (
          <div className="pn-static">
            <Icon name={p.cornerMethod === "miter" ? "scissors" : "skirting"} size={16} />
            {p.cornerMethod === "miter"
              ? p.cableChannel
                ? "Запил 45° — не нужны угловые элементы"
                : "Запил 45° — уголки не нужны"
              : "Фурнитура (уголки)"}
          </div>
        )}
      </Field>

      <div className="pn-grid2">
        <NumberField
          label="Цена планки"
          value={p.price}
          suffix="₽"
          min={0}
          max={1_000_000}
          step={10}
          onChange={(v) => update({ price: v })}
        />
        <FasteningField product={p} update={update} />
      </div>
      <p className="pn-note">Цены примерные — укажите цены своего магазина, итог пересчитается.</p>

      <Disclosure title="Цены фурнитуры и крепежа">
        <AccessoryPricesForm product={p} update={update} />
      </Disclosure>
    </Section>
  );
});

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="pn-fact">
      <span className="pn-fact__k">{k}</span>
      <span className="pn-fact__v num">{v}</span>
    </div>
  );
}

/** Клавиши, которыми листают группу radio (rovingKeyDown выбирает соседний вариант). */
const ROVING_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

function PlankLength({
  product: p,
  update,
}: {
  product: SkirtingProduct;
  update: (patch: ProductOverridePatch) => void;
}) {
  const standard = p.lengths.some((l) => Math.abs(l - p.length) < 1e-6);
  const [otherOpen, setOtherOpen] = useState(false);
  /** Поле своей длины забирает фокус, только если «Другая» выбрана нажатием, а не стрелками. */
  const [focusOther, setFocusOther] = useState(false);
  const viaArrows = useRef(false);
  const showOther = otherOpen || !standard;
  const value = showOther ? "other" : String(p.length);
  const options = [
    ...[...p.lengths].sort((a, b) => a - b).map((l) => ({ value: String(l), label: lengthLabel(l) })),
    { value: "other", label: "Другая" },
  ];
  const onChange = (v: string) => {
    if (v === "other") {
      setOtherOpen(true);
      setFocusOther(!viaArrows.current);
      return;
    }
    setOtherOpen(false);
    update({ length: Number(v) });
  };
  // Стрелки внутри группы выбирают соседний вариант синхронно (click) — помечаем такой выбор.
  // Сброс — следующей задачей: микрозадача выполнилась бы между фазами
  // перехвата и всплытия, раньше обработчика группы.
  const onKeyDownCapture = (e: KeyboardEvent<HTMLElement>) => {
    if (!ROVING_KEYS.has(e.key)) return;
    viaArrows.current = true;
    setTimeout(() => {
      viaArrows.current = false;
    }, 0);
  };
  const focusIndex = rovingFocusIndex(options, (o) => o.value === value);
  return (
    <Field label="Длина планки" hint="Чем длиннее планка, тем меньше стыков на длинных стенах.">
      <div className="pn-contents" onKeyDownCapture={onKeyDownCapture}>
        {options.length <= 5 ? (
          <Segmented<string> block value={value} ariaLabel="Длина планки" onChange={onChange} options={options} />
        ) : (
          <div className="pn-chips" role="radiogroup" aria-label="Длина планки" onKeyDown={rovingKeyDown}>
            {options.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={o.value === value}
                tabIndex={i === focusIndex ? 0 : -1}
                className={`pn-chip${o.value === value ? " is-active" : ""}`}
                onClick={() => onChange(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        {showOther ? (
          <LengthField
            className="pn-other-length"
            ariaLabel="Своя длина планки"
            value={p.length}
            unit="m"
            min={0.1}
            max={12}
            step={0.05}
            autoFocus={otherOpen && focusOther && standard}
            onChange={(v) => update({ length: v })}
          />
        ) : null}
      </div>
    </Field>
  );
}

const FASTENER_LABEL: Record<SkirtingProduct["fastening"], string> = {
  dowels: "Дюбель-гвоздь",
  clips: "Клипса",
  nails: "Гвоздь / саморез",
  glue: "Туба клея",
  adhesive: "Клей, 1 кг",
};

function FasteningField({
  product: p,
  update,
}: {
  product: SkirtingProduct;
  update: (patch: ProductOverridePatch) => void;
}) {
  if (p.fastening === "glue") {
    return (
      <NumberField
        label="Расход клея"
        value={p.glueRate}
        digits={1}
        suffix="м/туба"
        min={0.5}
        max={100}
        step={0.5}
        onChange={(v) => update({ glueRate: v })}
        hint="Погонных метров на одну тубу"
      />
    );
  }
  if (p.fastening === "adhesive") {
    return (
      <NumberField
        label="Расход клея"
        value={p.glueRate}
        digits={2}
        suffix="кг/м"
        min={0.05}
        max={10}
        step={0.05}
        onChange={(v) => update({ glueRate: v })}
        hint="Килограммов на погонный метр"
      />
    );
  }
  return (
    <LengthField
      label="Шаг крепежа"
      value={p.fastenerStep}
      unit="cm"
      digits={0}
      min={0.1}
      max={2}
      step={5}
      onChange={(v) => update({ fastenerStep: v })}
      hint={p.fastenerName}
    />
  );
}

function AccessoryPricesForm({
  product: p,
  update,
}: {
  product: SkirtingProduct;
  update: (patch: ProductOverridePatch) => void;
}) {
  const setPrice = (key: keyof AccessoryPrices) => (v: number) => update({ prices: { [key]: v } });
  const fittings = p.cornerMethod === "fittings";
  const usesGlue = p.fastening === "glue" || p.fastening === "adhesive";
  const fields: Array<{ key: keyof AccessoryPrices; label: string }> = [];
  if (fittings) {
    fields.push(
      { key: "innerCorner", label: "Угол внутренний" },
      { key: "outerCorner", label: "Угол наружный" },
    );
  }
  // У ПВХ с кабель-каналом заглушки и соединители остаются и при запиле (см. domain/estimate).
  if (fittings || p.cableChannel) {
    fields.push(
      { key: "endCap", label: "Заглушка" },
      { key: "connector", label: "Соединитель" },
    );
  }
  fields.push({ key: usesGlue ? "glue" : "fastener", label: FASTENER_LABEL[p.fastening] });

  return (
    <div className="pn-insp__group">
      <div className="pn-grid2">
        {fields.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            value={p.prices[f.key]}
            suffix="₽"
            min={0}
            max={100_000}
            step={5}
            onChange={setPrice(f.key)}
          />
        ))}
      </div>
      {!fittings ? (
        <p className="pn-note">
          {p.cableChannel
            ? "При запиле под 45° не нужны угловые элементы; заглушки и соединители остаются — торец кабель-канала закрывают заглушкой, стыки по длине стены — соединителем."
            : "При запиле под 45° уголки, заглушки и соединители не нужны."}
        </p>
      ) : null}
      {(fittings || p.cableChannel) && p.handedEndCaps ? (
        <p className="pn-note">Заглушки бывают левые и правые — цена у них одна, в списке покупок они посчитаны отдельно.</p>
      ) : null}
      {p.fastening === "clips" ? (
        <p className="pn-note">К каждой клипсе добавим дюбель — он посчитается отдельной строкой.</p>
      ) : null}
    </div>
  );
}

/* ------------------------ Параметры расчёта ----------------------- */

const CalcSettings = memo(function CalcSettings() {
  const st = useAppStore((s) => s.project.skirting);
  const roomsCount = useAppStore((s) => s.project.rooms.length);
  const update = (patch: Partial<SkirtingSettings>) => useAppStore.getState().updateSkirtingSettings(patch);
  const reserveStr = String(st.reservePct);

  return (
    <div className="pn-card pn-card--flush">
      <Disclosure
        title="Параметры расчёта"
        icon="settings"
        right={`запас ${formatNumber(st.reservePct, 1, { trim: true })} %`}
      >
        <div className="pn-insp__group">
          <Field
            label="Запас"
            hint="На брак и ошибки при резке. Обычно хватает 5 %, для сложных комнат — 10 %. Запас добавляется к числу планок после раскроя."
          >
            <div className="pn-reserve">
              <Segmented<string>
                size="sm"
                value={reserveStr}
                ariaLabel="Запас, %"
                onChange={(v) => update({ reservePct: Number(v) })}
                options={RESERVE_PRESETS.map((v) => ({ value: String(v), label: `${v} %` }))}
              />
              <NumberField
                className="pn-reserve__field"
                ariaLabel="Свой запас, %"
                value={st.reservePct}
                digits={1}
                suffix="%"
                min={0}
                max={100}
                onChange={(v) => update({ reservePct: v })}
              />
            </div>
          </Field>
          <div className="pn-grid2">
            <LengthField
              label="Минимальный кусок"
              value={st.minPiece}
              unit="cm"
              digits={0}
              min={0}
              max={2}
              step={5}
              onChange={(v) => update({ minPiece: v })}
            />
            <LengthField
              label="Пропил"
              value={st.kerf}
              unit="mm"
              digits={1}
              min={0}
              max={0.05}
              step={0.5}
              onChange={(v) => update({ kerf: v })}
            />
          </div>
          <p className="pn-note">
            <b>Минимальный кусок.</b> Если на стену не хватает целой планки, короткий обрезок у стыка смотрится
            плохо — тогда две последние планки делим поровну. <b>Пропил</b> — ширина реза пилы, теряется при
            каждом резе.
          </p>
          <Switch
            checked={st.shareOffcuts}
            onChange={(v) => update({ shareOffcuts: v })}
            label="Использовать обрезки между комнатами"
            hint={
              roomsCount > 1
                ? "Остаток планки из одной комнаты пойдёт в другую — купить нужно меньше"
                : "Пригодится, когда в проекте несколько комнат"
            }
          />
        </div>
      </Disclosure>
    </div>
  );
});
