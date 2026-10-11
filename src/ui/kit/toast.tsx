/** Всплывающие уведомления: toast("Ссылка скопирована"). */
import { create } from "zustand";
import { Icon } from "./Icon";

interface ToastItem {
  id: number;
  text: string;
  tone: "info" | "success" | "warning";
}

interface ToastState {
  items: ToastItem[];
  push(text: string, tone?: ToastItem["tone"]): void;
  dismiss(id: number): void;
}

let seq = 0;

const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push(text, tone = "success") {
    const id = ++seq;
    set({ items: [...get().items.slice(-2), { id, text, tone }] });
    window.setTimeout(() => get().dismiss(id), 2600);
  },
  dismiss(id) {
    set({ items: get().items.filter((t) => t.id !== id) });
  },
}));

export function toast(text: string, tone: ToastItem["tone"] = "success") {
  useToasts.getState().push(text, tone);
}

export function ToastHost() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="k-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`k-toast k-toast--${t.tone}`}
          onClick={() => dismiss(t.id)}
        >
          <Icon
            name={t.tone === "warning" ? "warning" : t.tone === "info" ? "info" : "check"}
            size={16}
          />
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}
