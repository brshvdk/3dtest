/**
 * Всплывающие уведомления: toast("Ссылка скопирована").
 * Уведомление не перехватывает клики (кроме своих кнопок), а таймер стоит на
 * паузе, пока указатель или фокус на его кнопках.
 */
import { create } from "zustand";
import { Icon } from "./Icon";

type Tone = "info" | "success" | "warning";

export interface ToastOptions {
  /** Кнопка в уведомлении («Вернуть»). Нажатие закрывает уведомление. */
  action?: { label: string; onClick: () => void };
  /** мс; по умолчанию 2600, с кнопкой — 8000. */
  duration?: number;
}

interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
  action?: ToastOptions["action"];
}

interface ToastState {
  items: ToastItem[];
  push(text: string, tone: Tone, opts: ToastOptions): void;
  dismiss(id: number): void;
}

let seq = 0;
const timers = new Map<number, { handle: number | null; remaining: number; startedAt: number }>();

function startTimer(id: number, ms: number) {
  const handle = window.setTimeout(() => useToasts.getState().dismiss(id), ms);
  timers.set(id, { handle, remaining: ms, startedAt: Date.now() });
}

function pause(id: number) {
  const t = timers.get(id);
  if (!t || t.handle === null) return;
  window.clearTimeout(t.handle);
  timers.set(id, { handle: null, remaining: Math.max(0, t.remaining - (Date.now() - t.startedAt)), startedAt: 0 });
}

function resume(id: number) {
  const t = timers.get(id);
  if (!t || t.handle !== null) return;
  startTimer(id, Math.max(1500, t.remaining));
}

const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push(text, tone, opts) {
    const id = ++seq;
    const items = [...get().items, { id, text, tone, action: opts.action }];
    // Не больше трёх одновременно: старые уходят.
    for (const old of items.slice(0, -3)) timers.delete(old.id);
    set({ items: items.slice(-3) });
    startTimer(id, opts.duration ?? (opts.action ? 8000 : 2600));
  },
  dismiss(id) {
    const timer = timers.get(id);
    if (timer?.handle) window.clearTimeout(timer.handle);
    timers.delete(id);
    set({ items: get().items.filter((t) => t.id !== id) });
  },
}));

export function toast(text: string, tone: Tone = "success", opts: ToastOptions = {}) {
  useToasts.getState().push(text, tone, opts);
}

export function ToastHost() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="k-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={`k-toast k-toast--${t.tone}`}
          onPointerEnter={() => pause(t.id)}
          onPointerLeave={() => resume(t.id)}
          onFocus={() => pause(t.id)}
          onBlur={() => resume(t.id)}
        >
          <Icon
            name={t.tone === "warning" ? "warning" : t.tone === "info" ? "info" : "check"}
            size={16}
          />
          <span className="k-toast__text">{t.text}</span>
          {t.action ? (
            <button
              type="button"
              className="k-toast__action"
              onClick={() => {
                dismiss(t.id);
                t.action?.onClick();
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="k-toast__close"
            aria-label="Закрыть уведомление"
            onClick={() => dismiss(t.id)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
