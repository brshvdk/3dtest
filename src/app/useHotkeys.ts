/**
 * Глобальные горячие клавиши:
 *  Ctrl/⌘+Z — отменить, Ctrl/⌘+Shift+Z / Ctrl+Y — повторить,
 *  Delete/Backspace — удалить выделенный проём или точку, Esc — снять выделение.
 */
import { useEffect } from "react";
import { useAppStore } from "../state/store";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/** Поля без своей истории ввода: select, флажки, цвет… */
const NO_TEXT_INPUT = new Set(["checkbox", "radio", "range", "color", "button", "submit", "reset", "file"]);

/**
 * Ctrl+Z / Ctrl+Y в поле: свой undo браузера нужен, только пока в поле есть
 * несохранённый текст. Select, флажки и поля кита без правок (data-pristine —
 * NumericInput, TextField) отдают сочетание истории проекта.
 */
function ownsUndo(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "SELECT") return false;
  if (target instanceof HTMLInputElement) {
    if (NO_TEXT_INPUT.has(target.type)) return false;
    return !target.hasAttribute("data-pristine");
  }
  return isTyping(target);
}

export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useAppStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && (key === "z" || key === "я")) {
        if (ownsUndo(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && (key === "y" || key === "н")) {
        if (ownsUndo(e.target)) return;
        e.preventDefault();
        s.redo();
        return;
      }
      if (isTyping(e.target)) return;

      if (e.key === "Escape") {
        s.select(null);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const sel = s.selection;
        if (!sel) return;
        if (sel.type === "opening") {
          e.preventDefault();
          s.removeOpening(sel.openingId);
        } else if (sel.type === "point") {
          e.preventDefault();
          s.removePoint(sel.pointId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
