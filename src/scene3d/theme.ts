/**
 * Цвета 3D-сцены из токенов темы. Тема меняется атрибутом data-theme на
 * <html> или системной настройкой — следим за обоими.
 */
import { useEffect, useState } from "react";

export interface SceneTheme {
  dark: boolean;
  bg: string;
  primary: string;
  accent: string;
  /** Срез стен («разрез» на чертеже). */
  section: string;
  /** Внешняя грань стен. */
  outer: string;
  /** Мягкая тень под моделью: непрозрачность. */
  shadow: number;
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function readTheme(): SceneTheme {
  const attr = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : null;
  const dark =
    attr === "dark" ||
    (attr !== "light" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return {
    dark,
    bg: cssVar("--plan-bg", dark ? "#16171a" : "#f7f6f2"),
    primary: cssVar("--primary", dark ? "#6f93ff" : "#2f5bd3"),
    accent: cssVar("--plan-skirting", dark ? "#ff8a3d" : "#ee6a1b"),
    section: dark ? "#3b3e46" : "#2e3136",
    outer: dark ? "#cfcbc3" : "#f1eee8",
    shadow: dark ? 0.75 : 0.32,
  };
}

export function useSceneTheme(): SceneTheme {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const update = () =>
      setTheme((prev) => {
        const next = readTheme();
        return prev.bg === next.bg && prev.primary === next.primary && prev.dark === next.dark ? prev : next;
      });
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", update);
    };
  }, []);
  return theme;
}
