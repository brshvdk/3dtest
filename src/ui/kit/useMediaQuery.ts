import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined") return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => (typeof window === "undefined" ? false : window.matchMedia(query).matches),
    () => false,
  );
}

/** Телефон: одна колонка, нижняя навигация. */
export const useIsMobile = () => useMediaQuery("(max-width: 760px)");
/** Узкий десктоп/планшет: итог переезжает в левую панель вкладкой. */
export const useIsCompact = () => useMediaQuery("(max-width: 1240px)");
