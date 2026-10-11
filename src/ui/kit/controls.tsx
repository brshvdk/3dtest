/**
 * Базовые контролы интерфейса: кнопки, поля, переключатели.
 * Стили — kit.css (классы с префиксом k-).
 */
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  formatNumber,
  fromMeters,
  parseLength,
  parseNumber,
  roundTo,
  toMeters,
  UNIT_LABEL,
  type LengthUnit,
} from "../../domain/units";
import { Icon, type IconName } from "./Icon";

/* ------------------------------- Button ------------------------------ */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconRight?: IconName;
  block?: boolean;
  active?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    icon,
    iconRight,
    block,
    active,
    className,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  const cls = [
    "k-btn",
    `k-btn--${variant}`,
    `k-btn--${size}`,
    block ? "k-btn--block" : "",
    active ? "is-active" : "",
    !children ? "k-btn--icon-only" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const iconSize = size === "sm" ? 15 : size === "lg" ? 20 : 17;
  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children ? <span className="k-btn__label">{children}</span> : null}
      {iconRight ? <Icon name={iconRight} size={iconSize} /> : null}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: "sm" | "md";
  variant?: ButtonVariant;
  active?: boolean;
}

/** Кнопка-иконка. label обязателен — это aria-label и всплывающая подсказка. */
export function IconButton({
  icon,
  label,
  size = "md",
  variant = "ghost",
  active,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={[
        "k-btn",
        `k-btn--${variant}`,
        `k-btn--${size}`,
        "k-btn--icon-only",
        active ? "is-active" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 15 : 18} />
    </button>
  );
}

/* ---------------------- Группы radio / tab (клавиатура) --------------- */

/**
 * Клавиатурная модель WAI-ARIA для групп radio и tab: в группе одна остановка
 * Tab (tabIndex 0 только у выбранного), стрелки и Home/End переводят фокус и
 * выбор на соседний элемент. Вешается на onKeyDown контейнера группы.
 */
export function rovingKeyDown(e: KeyboardEvent<HTMLElement>): void {
  const step =
    e.key === "ArrowRight" || e.key === "ArrowDown"
      ? 1
      : e.key === "ArrowLeft" || e.key === "ArrowUp"
        ? -1
        : e.key === "Home" || e.key === "End"
          ? 0
          : null;
  if (step === null || e.altKey || e.ctrlKey || e.metaKey) return;
  const items = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"], [role="tab"]'),
  ).filter((el) => !el.disabled);
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0 || !items.length) return;
  const n = items.length;
  const next =
    e.key === "Home" ? items[0] : e.key === "End" ? items[n - 1] : items[(i + step + n) % n];
  // Стрелки не должны доходить до глобальных обработчиков (сдвиг выделенного на плане).
  e.preventDefault();
  e.stopPropagation();
  next.focus();
  next.click();
}

/** Индекс элемента группы с tabIndex 0: выбранный, а если его нет — первый доступный. */
export function rovingFocusIndex<T>(items: T[], isSelected: (it: T) => boolean, isDisabled?: (it: T) => boolean): number {
  const ok = (it: T) => !isDisabled?.(it);
  const selected = items.findIndex((it) => isSelected(it) && ok(it));
  return selected >= 0 ? selected : items.findIndex(ok);
}

/* ------------------------------ Segmented ---------------------------- */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  title?: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  block,
  ariaLabel,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  block?: boolean;
  ariaLabel?: string;
}) {
  const focusIndex = rovingFocusIndex(options, (o) => o.value === value, (o) => !!o.disabled);
  return (
    <div
      className={`k-seg k-seg--${size}${block ? " k-seg--block" : ""}`}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={rovingKeyDown}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === focusIndex ? 0 : -1}
          className={o.value === value ? "is-active" : ""}
          onClick={() => onChange(o.value)}
          title={o.title}
          disabled={o.disabled}
        >
          {o.icon ? <Icon name={o.icon} size={size === "sm" ? 14 : 16} /> : null}
          {o.label ? <span>{o.label}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------- Field ------------------------------ */

export function Field({
  label,
  hint,
  children,
  htmlFor,
  inline,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  inline?: boolean;
  className?: string;
}) {
  return (
    <div className={`k-field${inline ? " k-field--inline" : ""} ${className ?? ""}`}>
      {label ? (
        <label className="k-field__label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      <div className="k-field__control">{children}</div>
      {hint ? <div className="k-field__hint">{hint}</div> : null}
    </div>
  );
}

/* ----------------------------- Числовые поля ------------------------- */

interface BaseNumericProps {
  id?: string;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  inline?: boolean;
  className?: string;
  placeholder?: string;
  /** Подпись внутри поля справа (единица). */
  suffix?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}

/**
 * Поле длины. value — метры; показывается в unit. Понимает ввод «4,2»,
 * «420 см», «4 м 20 см». Применяет значение по Enter/blur, стрелки ↑/↓
 * меняют на step (в единицах unit, Shift — ×10).
 */
export function LengthField({
  value,
  onChange,
  unit = "m",
  digits,
  min = 0,
  max = Infinity,
  step,
  ...rest
}: BaseNumericProps & {
  value: number;
  onChange: (meters: number) => void;
  unit?: LengthUnit;
  digits?: number;
  /** м */
  min?: number;
  /** м */
  max?: number;
  /** в единицах unit */
  step?: number;
}) {
  const d = digits ?? (unit === "m" ? 2 : unit === "cm" ? 1 : 0);
  const stepU = step ?? (unit === "m" ? 0.05 : unit === "cm" ? 1 : 1);
  const toText = (m: number) =>
    formatNumber(roundTo(fromMeters(m, unit), d), d, { trim: unit !== "m" }).replace(
      / /g,
      " ",
    );
  return (
    <NumericInput
      {...rest}
      suffix={rest.suffix ?? UNIT_LABEL[unit]}
      text={toText(value)}
      parse={(s) => parseLength(s, unit)}
      clamp={(m) => Math.min(max, Math.max(min, m))}
      onCommit={onChange}
      onStep={(dir, big) => {
        const cur = fromMeters(value, unit);
        const next = roundTo(cur + dir * stepU * (big ? 10 : 1), 6);
        onChange(Math.min(max, Math.max(min, toMeters(next, unit))));
      }}
    />
  );
}

/** Обычное число (цена, проценты, штуки). */
export function NumberField({
  value,
  onChange,
  digits = 0,
  min = -Infinity,
  max = Infinity,
  step = 1,
  ...rest
}: BaseNumericProps & {
  value: number;
  onChange: (v: number) => void;
  digits?: number;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <NumericInput
      {...rest}
      text={formatNumber(roundTo(value, digits), digits, { trim: true }).replace(
        / /g,
        " ",
      )}
      parse={parseNumber}
      clamp={(v) => Math.min(max, Math.max(min, v))}
      onCommit={onChange}
      onStep={(dir, big) =>
        onChange(
          Math.min(max, Math.max(min, roundTo(value + dir * step * (big ? 10 : 1), 6))),
        )
      }
    />
  );
}

function NumericInput({
  id,
  label,
  hint,
  disabled,
  inline,
  className,
  placeholder,
  suffix,
  autoFocus,
  ariaLabel,
  text,
  parse,
  clamp,
  onCommit,
  onStep,
}: BaseNumericProps & {
  text: string;
  parse: (s: string) => number | null;
  clamp: (v: number) => number;
  onCommit: (v: number) => void;
  onStep: (dir: 1 | -1, big: boolean) => void;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [draft, setDraft] = useState(text);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  // Пользователь что-то напечатал с момента фокуса. Если нет — blur ничего не
  // применяет (иначе после стрелок ↑/↓ старый текст вернул бы старое значение).
  const dirtyRef = useRef(false);
  // Следующий blur не должен применять ввод (Esc — отмена, Enter — уже применён).
  const skipBlurRef = useRef(false);
  // Фокус пришёл кликом: mouseup не должен снять выделение текста (см. onMouseUp).
  const keepSelectionRef = useRef(false);

  // Внешнее значение меняется (перетаскивание на плане, стрелки) — обновляем
  // черновик, если пользователь сейчас не печатает.
  useEffect(() => {
    if (!focused || !dirtyRef.current) setDraft(text);
  }, [text, focused]);

  const commit = () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const v = parse(draft);
    if (v === null) {
      setError(true);
      setDraft(text);
      window.setTimeout(() => setError(false), 900);
      return;
    }
    onCommit(clamp(v));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commit();
      skipBlurRef.current = true;
      ref.current?.blur();
    } else if (e.key === "Escape") {
      dirtyRef.current = false;
      setDraft(text);
      skipBlurRef.current = true;
      ref.current?.blur();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      // Напечатанное, но не применённое значение — сначала применяем.
      if (dirtyRef.current) {
        commit();
        return;
      }
      onStep(e.key === "ArrowUp" ? 1 : -1, e.shiftKey);
    }
  };

  const input = (
    <div
      className={`k-input${error ? " is-error" : ""}${disabled ? " is-disabled" : ""}`}
    >
      <input
        ref={ref}
        id={inputId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={focused ? draft : text}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-invalid={error || undefined}
        // Нет несохранённого ввода — Ctrl+Z отменяет правку проекта (useHotkeys).
        data-pristine={!focused || !dirtyRef.current ? "" : undefined}
        onFocus={(e) => {
          setFocused(true);
          setDraft(text);
          dirtyRef.current = false;
          skipBlurRef.current = false;
          // Выделяем сразу, а не в следующем кадре: отложенный select() успевал
          // «съесть» первую набранную цифру и возвращал фокус в уже покинутое поле.
          e.currentTarget.select();
        }}
        onMouseDown={(e) => {
          keepSelectionRef.current = document.activeElement !== e.currentTarget;
        }}
        onMouseUp={(e) => {
          // Клик, давший фокус: mouseup поставил бы каретку и снял выделение.
          if (keepSelectionRef.current) e.preventDefault();
          keepSelectionRef.current = false;
        }}
        onBlur={() => {
          keepSelectionRef.current = false;
          setFocused(false);
          if (skipBlurRef.current) skipBlurRef.current = false;
          else commit();
        }}
        onChange={(e) => {
          dirtyRef.current = true;
          setDraft(e.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      {suffix ? <span className="k-input__suffix">{suffix}</span> : null}
    </div>
  );

  if (!label && !hint) return <div className={className}>{input}</div>;
  return (
    <Field label={label} hint={hint} htmlFor={inputId} inline={inline} className={className}>
      {input}
    </Field>
  );
}

/* ------------------------------- TextField --------------------------- */

export function TextField({
  value,
  onChange,
  label,
  placeholder,
  maxLength = 60,
  ariaLabel,
  list,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: ReactNode;
  placeholder?: string;
  maxLength?: number;
  ariaLabel?: string;
  list?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const cancelRef = useRef(false);
  const prevValueRef = useRef(value);
  // Значение сменилось снаружи (Ctrl+Z, другая вкладка): черновик без правок
  // следует за ним и в фокусе — иначе blur вернул бы старый текст.
  useEffect(() => {
    if (!focused || draft === prevValueRef.current) setDraft(value);
    prevValueRef.current = value;
  }, [value, focused]);
  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      setDraft(value);
      return;
    }
    const v = draft.trim();
    if (v && v !== value) onChange(v);
    else setDraft(value);
  };
  const input = (
    <div className="k-input">
      <input
        id={id}
        type="text"
        value={focused ? draft : value}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-label={ariaLabel}
        list={list}
        data-pristine={!focused || draft === value ? "" : undefined}
        onFocus={() => {
          setFocused(true);
          setDraft(value);
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            cancelRef.current = true;
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
  return label ? (
    <Field label={label} htmlFor={id}>
      {input}
    </Field>
  ) : (
    input
  );
}

/* -------------------------------- Select ----------------------------- */

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

export function Select({
  value,
  options,
  onChange,
  label,
  hint,
  ariaLabel,
  disabled,
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  label?: ReactNode;
  hint?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const groups = new Map<string, SelectOption[]>();
  const plain: SelectOption[] = [];
  for (const o of options) {
    if (o.group) {
      if (!groups.has(o.group)) groups.set(o.group, []);
      groups.get(o.group)!.push(o);
    } else plain.push(o);
  }
  const el = (
    <div className="k-select">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        {plain.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {[...groups.entries()].map(([g, opts]) => (
          <optgroup key={g} label={g}>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <Icon name="chevron-down" size={16} className="k-select__chevron" />
    </div>
  );
  return label || hint ? (
    <Field label={label} hint={hint} htmlFor={id}>
      {el}
    </Field>
  ) : (
    el
  );
}

/* -------------------------------- Switch ----------------------------- */

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={`k-switch${disabled ? " is-disabled" : ""}`}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`k-switch__track${checked ? " is-on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="k-switch__thumb" />
      </button>
      <label htmlFor={id} className="k-switch__text">
        <span className="k-switch__label">{label}</span>
        {hint ? <span className="k-switch__hint">{hint}</span> : null}
      </label>
    </div>
  );
}

/* ------------------------------ Прочее ------------------------------- */

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "primary" | "accent" | "success" | "warning" | "danger";
  title?: string;
}) {
  return (
    <span className={`k-badge k-badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Section({
  title,
  subtitle,
  actions,
  children,
  className,
  step,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  step?: number;
}) {
  return (
    <section className={`k-section ${className ?? ""}`}>
      {title || actions ? (
        <header className="k-section__head">
          <div className="k-section__titles">
            <h3 className="k-section__title">
              {step ? <span className="k-section__step">{step}</span> : null}
              {title}
            </h3>
            {subtitle ? <p className="k-section__subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="k-section__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Disclosure({
  title,
  children,
  defaultOpen = false,
  right,
  icon,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
  icon?: IconName;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`k-disclosure${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="k-disclosure__head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="chevron-right" size={16} className="k-disclosure__chevron" />
        {icon ? <Icon name={icon} size={16} /> : null}
        <span className="k-disclosure__title">{title}</span>
        {right ? <span className="k-disclosure__right">{right}</span> : null}
      </button>
      {open ? <div className="k-disclosure__body">{children}</div> : null}
    </div>
  );
}

export function Callout({
  tone = "info",
  children,
  icon,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  children: ReactNode;
  icon?: IconName;
}) {
  const ic: IconName =
    icon ?? (tone === "warning" || tone === "danger" ? "warning" : tone === "success" ? "check" : "info");
  return (
    <div className={`k-callout k-callout--${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <Icon name={ic} size={16} />
      <div>{children}</div>
    </div>
  );
}

/** Ряд цветных кружков для выбора цвета. */
export function ColorSwatches({
  value,
  colors,
  onChange,
  allowCustom = true,
  ariaLabel = "Цвет",
}: {
  value: string;
  colors: { name: string; hex: string }[];
  onChange: (hex: string) => void;
  allowCustom?: boolean;
  ariaLabel?: string;
}) {
  const isActive = (hex: string) => hex.toLowerCase() === value.toLowerCase();
  const isCustom = !colors.some((c) => isActive(c.hex));
  const focusIndex = rovingFocusIndex(colors, (c) => isActive(c.hex));
  return (
    <div className="k-swatches" role="radiogroup" aria-label={ariaLabel} onKeyDown={rovingKeyDown}>
      {colors.map((c, i) => (
        <button
          key={c.hex}
          type="button"
          role="radio"
          aria-checked={isActive(c.hex)}
          tabIndex={i === focusIndex ? 0 : -1}
          title={c.name}
          aria-label={c.name}
          className={`k-swatch${isActive(c.hex) ? " is-active" : ""}`}
          style={{ background: c.hex }}
          onClick={() => onChange(c.hex)}
        />
      ))}
      {allowCustom ? (
        <label
          className={`k-swatch k-swatch--custom${isCustom ? " is-active" : ""}`}
          title="Свой цвет"
          style={isCustom ? { background: value } : undefined}
        >
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Свой цвет"
          />
          {!isCustom ? <Icon name="plus" size={14} /> : null}
        </label>
      ) : null}
    </div>
  );
}

/** Строка «ключ — значение» для сводок. */
export function KV({
  k,
  v,
  strong,
  hint,
}: {
  k: ReactNode;
  v: ReactNode;
  strong?: boolean;
  hint?: ReactNode;
}) {
  return (
    <div className={`k-kv${strong ? " k-kv--strong" : ""}`}>
      <span className="k-kv__k">
        {k}
        {hint ? <span className="k-kv__hint">{hint}</span> : null}
      </span>
      <span className="k-kv__v num">{v}</span>
    </div>
  );
}
