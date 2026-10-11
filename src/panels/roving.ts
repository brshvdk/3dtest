/**
 * Клавиатура групп radio, где выбор — не «бесплатное» действие (открывает
 * подтверждение, сворачивает список): стрелки и Home/End только переводят
 * фокус, как rovingKeyDown из kit, но без выбора. Выбирают Enter или
 * пробелом (обычный click кнопки). Tab-остановка — через rovingFocusIndex.
 */
import type { KeyboardEvent } from "react";

export function rovingFocusKeyDown(e: KeyboardEvent<HTMLElement>): void {
  const step =
    e.key === "ArrowRight" || e.key === "ArrowDown"
      ? 1
      : e.key === "ArrowLeft" || e.key === "ArrowUp"
        ? -1
        : e.key === "Home" || e.key === "End"
          ? 0
          : null;
  if (step === null || e.altKey || e.ctrlKey || e.metaKey) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')).filter(
    (el) => !(el instanceof HTMLButtonElement && el.disabled) && el.getAttribute("aria-disabled") !== "true",
  );
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const n = items.length;
  const next = e.key === "Home" ? items[0] : e.key === "End" ? items[n - 1] : items[(i + step + n) % n];
  // Стрелки не должны доходить до глобальных обработчиков (сдвиг выделенного на плане).
  e.preventDefault();
  e.stopPropagation();
  next.focus();
}
