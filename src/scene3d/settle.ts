/**
 * «Устоявшееся» значение для тяжёлых пересчётов сцены (карта затенения
 * пола): пока на плане тянут стену или угол, сцена живёт со старым
 * значением, а новое берёт, когда кнопку/палец отпустили и правки утихли.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/* ---------------- Нажатые указатели (мышь, перо, пальцы) ---------------- */

const pressed = new Set<number>();
const onRelease = new Set<() => void>();
let tracking = false;

function release(id?: number) {
  if (id === undefined) pressed.clear();
  else pressed.delete(id);
  if (!pressed.size) onRelease.forEach((l) => l());
}

function trackPointers() {
  if (tracking || typeof window === "undefined") return;
  tracking = true;
  // Захват: жест на плане может останавливать всплытие событий.
  window.addEventListener("pointerdown", (e) => pressed.add(e.pointerId), true);
  window.addEventListener("pointerup", (e) => release(e.pointerId), true);
  window.addEventListener("pointercancel", (e) => release(e.pointerId), true);
  // Отпустили за пределами окна — событие могло не прийти.
  window.addEventListener("blur", () => release());
}

/**
 * Значение догоняет value через delay мс после последней смены, но не
 * раньше, чем отпустят все указатели. Первая смена после затишья
 * применяется сразу (переключили комнату — без «чужой» картинки).
 */
export function useSettled<T>(value: T, delay = 160): T {
  const [settled, setSettled] = useState(value);
  const lastChange = useRef(-Infinity);

  useLayoutEffect(() => {
    trackPointers();
  }, []);

  // Затишье и ничего не тянут — сразу, до кадра.
  useLayoutEffect(() => {
    const now = performance.now();
    const idle = now - lastChange.current > delay;
    lastChange.current = now;
    if (idle && !pressed.size) setSettled(value);
  }, [value, delay]);

  useEffect(() => {
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      if (!pressed.size) timer = window.setTimeout(() => setSettled(value), delay);
    };
    arm();
    onRelease.add(arm);
    return () => {
      window.clearTimeout(timer);
      onRelease.delete(arm);
    };
  }, [value, delay]);

  return settled;
}
