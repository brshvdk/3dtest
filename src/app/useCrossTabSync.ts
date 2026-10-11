/**
 * Несколько вкладок с Меркой: правка в одной вкладке — в том числе «Отменить»
 * и «Повторить» — подхватывается в остальных (событие storage), а не
 * затирается их следующей записью. Прежняя версия этой вкладки остаётся в
 * истории — «Отменить». Как отличаем свежую правку от эха — см. tabSync.ts.
 */
import { useEffect } from "react";
import type { Project } from "../domain/types";
import { HISTORY_LIMIT, useAppStore } from "../state/store";
import { toast } from "../ui/kit";
import { createTabSync } from "./tabSync";

/** Не чаще одного уведомления за столько мс (другая вкладка пишет сериями). */
const TOAST_EVERY_MS = 10_000;

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useCrossTabSync() {
  useEffect(() => {
    let lastToast = 0;
    /** Проект меняем мы сами (принят из другой вкладки) — это не своя правка. */
    let applying = false;

    const apply = (incoming: Project) => {
      const s = useAppStore.getState();
      const activeRoomId = incoming.rooms.some((r) => r.id === s.activeRoomId)
        ? s.activeRoomId
        : incoming.rooms[0].id;
      applying = true;
      try {
        useAppStore.setState({
          project: incoming,
          activeRoomId,
          past: [...s.past, s.project].slice(-HISTORY_LIMIT),
          future: [],
        });
        // Выделение могло ссылаться на удалённую стену или проём — стор его проверит.
        useAppStore.getState().select(s.selection);
      } finally {
        applying = false;
      }

      const now = Date.now();
      if (now - lastToast > TOAST_EVERY_MS) {
        lastToast = now;
        toast("Проект изменён в другой вкладке — показываем свежую версию", "info", {
          action: { label: "Отменить", onClick: () => useAppStore.getState().undo() },
        });
      }
    };

    const sync = createTabSync({
      tab: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      storage: getStorage(),
      current: () => useAppStore.getState().project,
      apply,
    });

    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (!applying && s.project !== prev.project) sync.authored(s.project);
    });
    const onStorage = (e: StorageEvent) => sync.onStorage(e.key, e.newValue);
    const onHide = () => {
      if (document.visibilityState === "hidden") sync.flush();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", sync.flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", sync.flush);
      document.removeEventListener("visibilitychange", onHide);
      sync.dispose();
    };
  }, []);
}
