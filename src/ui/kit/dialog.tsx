/**
 * Диалог подтверждения вместо системного window.confirm:
 *
 *   if (await confirmAction({ title: "Удалить комнату?", confirmLabel: "Удалить", tone: "danger" })) …
 *
 * Модальный: фон недоступен (inert — ни клик, ни Tab, ни скринридер), горячие
 * клавиши приложения (Ctrl+Z, Delete…) не срабатывают. Tab ходит по кругу по
 * кнопкам диалога, Esc / клик по фону — «Отмена», Enter — нажать кнопку в
 * фокусе (сначала это кнопка действия). Фокус возвращается туда, где был.
 * На телефоне диалог прижат к низу экрана, кнопки — во всю ширину.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Button } from "./controls";
import { Icon, type IconName } from "./Icon";

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger — красная кнопка действия (удаление). */
  tone?: "primary" | "danger";
  /** Значок слева; по умолчанию корзина для danger и «i» для primary. */
  icon?: IconName;
}

interface DialogState {
  current: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
  open(opts: ConfirmOptions): Promise<boolean>;
  close(ok: boolean): void;
}

const useDialog = create<DialogState>((set, get) => ({
  current: null,
  open(opts) {
    // Открытый диалог закрываем как «Отмена» — одновременно только один.
    get().current?.resolve(false);
    return new Promise<boolean>((resolve) => set({ current: { ...opts, resolve } }));
  },
  close(ok) {
    const cur = get().current;
    if (!cur) return;
    set({ current: null });
    cur.resolve(ok);
  },
}));

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return useDialog.getState().open(opts);
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function DialogHost() {
  const current = useDialog((s) => s.current);
  const close = useDialog((s) => s.close);
  const titleId = useId();
  const textId = useId();
  const okRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  // Нажатие началось на фоне: закрываем по click, а не по pointerdown — иначе
  // отпускание пальца «проваливается» в приложение под исчезнувшим диалогом.
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    if (!current) return;
    const active = document.activeElement;
    const prev = active instanceof HTMLElement && active !== document.body ? active : null;

    // Всё, кроме диалога, — inert: фокус, клики и чтение скринридером не уходят на фон.
    const inerted: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el instanceof HTMLElement && el !== backdropRef.current && !el.inert) {
        el.inert = true;
        inerted.push(el);
      }
    }
    okRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      // Модальный диалог: клавиши не доходят до горячих клавиш приложения
      // (Ctrl+Z, Delete, Esc снимает выделение). Действие по умолчанию — нажатие
      // кнопки в фокусе по Enter/пробелу — не отменяется.
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter" && e.repeat) {
        // Зажатый Enter, которым диалог открыли, не должен сразу его подтвердить.
        e.preventDefault();
      } else if (e.key === "Tab" && boxRef.current) {
        // Ловушка фокуса: по кругу между элементами диалога, даже если фокус
        // оказался на самом окне (клик по тексту) или вне его.
        const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey
          ? items[i <= 0 ? items.length - 1 : i - 1]
          : items[i === -1 || i === items.length - 1 ? 0 : i + 1];
        next.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      for (const el of inerted) el.inert = false;
      if (prev?.isConnected) prev.focus({ preventScroll: true });
    };
  }, [current, close]);

  if (!current) return null;
  const danger = current.tone === "danger";
  return createPortal(
    <div
      ref={backdropRef}
      className="k-dialog-backdrop"
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) close(false);
        downOnBackdrop.current = false;
      }}
    >
      <div
        ref={boxRef}
        className={`k-dialog${danger ? " is-danger" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={current.message ? textId : undefined}
        // Клик по тексту окна оставляет фокус в диалоге (а не на <body>).
        tabIndex={-1}
      >
        <div className={`k-dialog__icon${danger ? " is-danger" : ""}`} aria-hidden>
          <Icon name={current.icon ?? (danger ? "trash" : "info")} size={20} />
        </div>
        <div className="k-dialog__body">
          <h2 id={titleId} className="k-dialog__title">
            {current.title}
          </h2>
          {current.message ? (
            <div id={textId} className="k-dialog__text">
              {current.message}
            </div>
          ) : null}
        </div>
        <div className="k-dialog__actions">
          <Button variant="secondary" onClick={() => close(false)}>
            {current.cancelLabel ?? "Отмена"}
          </Button>
          <Button ref={okRef} variant={danger ? "danger-solid" : "primary"} onClick={() => close(true)}>
            {current.confirmLabel ?? "Да"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
