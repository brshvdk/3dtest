/**
 * Прокрутка к элементу из JS: CSS-правило prefers-reduced-motion на неё не
 * действует, поэтому при «меньше анимации» прокручиваем сразу.
 */
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
