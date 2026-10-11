/**
 * Диалог подтверждения вместо системного window.confirm:
 *
 *   if (await confirmAction({ title: "Удалить комнату?", confirmLabel: "Удалить", tone: "danger" })) …
 *
 * Esc / клик по фону — «Отмена», Enter — подтверждение. Фокус ставится на
 * кнопку действия и возвращается туда, где был, после закрытия.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { create } from "zustand";
import { Button } from "./controls";
import { Icon } from "./Icon";

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger — красная кнопка действия (удаление). */
  tone?: "primary" | "danger";
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

export function DialogHost() {
  const current = useDialog((s) => s.current);
  const close = useDialog((s) => s.close);
  const titleId = useId();
  const textId = useId();
  const okRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!current) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (e.key === "Tab" && boxRef.current) {
        // Простая ловушка фокуса между кнопками диалога.
        const items = boxRef.current.querySelectorAll<HTMLElement>("button");
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [current, close]);

  if (!current) return null;
  const danger = current.tone === "danger";
  return (
    <div className="k-dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close(false)}>
      <div
        ref={boxRef}
        className="k-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={current.message ? textId : undefined}
      >
        <div className={`k-dialog__icon${danger ? " is-danger" : ""}`} aria-hidden>
          <Icon name={danger ? "trash" : "info"} size={20} />
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
          <Button
            ref={okRef}
            variant={danger ? "danger-solid" : "primary"}
            onClick={() => close(true)}
          >
            {current.confirmLabel ?? "Да"}
          </Button>
        </div>
      </div>
    </div>
  );
}
