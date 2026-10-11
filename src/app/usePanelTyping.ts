/**
 * Телефон: пока пользователь печатает в поле левой панели, план ужимается до
 * полосы, а поле держится в видимой части панели — и когда экранная
 * клавиатура уменьшает окно (visualViewport), и когда панель меняет высоту.
 */
import { useEffect, useState } from "react";

const TEXT_ENTRY =
  'input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="button"], [type="submit"]), textarea, [contenteditable="true"]';

function panelField(el: Element | null): HTMLElement | null {
  return el instanceof HTMLElement && el.matches(TEXT_ENTRY) && el.closest(".sidebar__body") ? el : null;
}

/** Прокручивает панель так, чтобы поле было в середине видимой её части. */
function revealField(field: HTMLElement) {
  const body = field.closest<HTMLElement>(".sidebar__body");
  if (!body) return;
  const vv = window.visualViewport;
  const b = body.getBoundingClientRect();
  const r = field.getBoundingClientRect();
  const top = b.top;
  const bottom = Math.min(b.bottom, vv ? vv.offsetTop + vv.height : b.bottom);
  if (bottom - top < r.height) return;
  if (r.top >= top + 8 && r.bottom <= bottom - 8) return;
  body.scrollTop += r.top + r.height / 2 - (top + bottom) / 2;
}

export function usePanelTyping(enabled: boolean): boolean {
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setTyping(false);
      return;
    }
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      // focusout → focusin при переходе между полями: решаем по итоговому фокусу.
      raf = requestAnimationFrame(() => setTyping(!!panelField(document.activeElement)));
    };
    const reveal = () => {
      const field = panelField(document.activeElement);
      if (field) requestAnimationFrame(() => revealField(field));
    };
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    window.visualViewport?.addEventListener("resize", reveal);
    window.addEventListener("resize", reveal);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      window.visualViewport?.removeEventListener("resize", reveal);
      window.removeEventListener("resize", reveal);
    };
  }, [enabled]);

  // План ужался — панель выросла: поле должно остаться на виду.
  useEffect(() => {
    if (!typing) return;
    const field = panelField(document.activeElement);
    if (!field) return;
    const t = window.setTimeout(() => revealField(field), 60);
    return () => window.clearTimeout(t);
  }, [typing]);

  return typing;
}
