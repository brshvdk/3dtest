/**
 * Выпадающее меню у кнопки-иконки (паттерн WAI-ARIA menu button):
 * Enter/Пробел/↓ открывают и ставят фокус на первый пункт, ↑/↓/Home/End —
 * между пунктами, Esc и клик мимо — закрыть (фокус возвращается на кнопку).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type MenuEntry =
  | {
      id: string;
      label: ReactNode;
      hint?: ReactNode;
      icon?: IconName;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { id: string; heading: ReactNode }
  | { id: string; separator: true };

export function MenuButton({
  icon,
  label,
  items,
  className,
}: {
  icon: IconName;
  /** aria-label и подсказка кнопки. */
  label: string;
  items: MenuEntry[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // Куда поставить фокус при открытии: первый или последний пункт.
  const focusOnOpen = useRef<"first" | "last">("first");

  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);

  useEffect(() => {
    if (!open) return;
    const list = menuItems();
    (focusOnOpen.current === "last" ? list[list.length - 1] : list[0])?.focus();
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusOnOpen.current = e.key === "ArrowUp" ? "last" : "first";
      setOpen(true);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = menuItems();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (e.key === "ArrowDown") next = list[(i + 1) % list.length];
    else if (e.key === "ArrowUp") next = list[(i - 1 + list.length) % list.length];
    else if (e.key === "Home") next = list[0];
    else if (e.key === "End") next = list[list.length - 1];
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    } else if (e.key === "Tab") {
      setOpen(false);
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    next?.focus();
  };

  return (
    <div className={`k-menu ${className ?? ""}`} ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className={`k-btn k-btn--ghost k-btn--md k-btn--icon-only${open ? " is-active" : ""}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          focusOnOpen.current = "first";
          setOpen((v) => !v);
        }}
        onKeyDown={onButtonKey}
      >
        <Icon name={icon} size={18} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className="k-menu__list"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
        >
          {items.map((it) =>
            "separator" in it ? (
              <div key={it.id} className="k-menu__sep" role="separator" />
            ) : "heading" in it ? (
              <div key={it.id} className="k-menu__heading" role="presentation">
                {it.heading}
              </div>
            ) : (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="k-menu__item"
                disabled={it.disabled}
                onClick={() => {
                  close(true);
                  it.onSelect();
                }}
              >
                {it.icon ? <Icon name={it.icon} size={17} /> : null}
                <span className="k-menu__texts">
                  <span className="k-menu__label">{it.label}</span>
                  {it.hint ? <span className="k-menu__hint">{it.hint}</span> : null}
                </span>
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
