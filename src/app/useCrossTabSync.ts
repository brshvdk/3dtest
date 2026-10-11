/**
 * Несколько вкладок с Меркой: правка в одной вкладке подхватывается в
 * остальных (событие storage по ключу стора), а не затирается их следующей
 * записью. Прежняя версия этой вкладки остаётся в истории — «Отменить».
 */
import { useEffect } from "react";
import { migrateProject } from "../domain/project";
import { HISTORY_LIMIT, useAppStore } from "../state/store";
import { toast } from "../ui/kit";

/** Ключ persist-хранилища стора (src/state/store.ts). */
const STORE_KEY = "merka:v1";
/** Не чаще одного уведомления за столько мс (другая вкладка пишет сериями). */
const TOAST_EVERY_MS = 10_000;

export function useCrossTabSync() {
  useEffect(() => {
    let lastToast = 0;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORE_KEY || !e.newValue) return;
      let raw: unknown;
      try {
        raw = (JSON.parse(e.newValue) as { state?: { project?: unknown } })?.state?.project;
      } catch {
        return;
      }
      const incoming = migrateProject(raw);
      if (!incoming) return;
      const s = useAppStore.getState();
      // Та же или более старая версия того же проекта — ничего не делаем. Другая вкладка
      // сохраняет принятый от нас проект, и это эхо может прийти позже нашей следующей
      // правки (таймеры фоновой вкладки замедлены): принять его — откатить свою правку
      // и запустить пинг-понг между вкладками.
      if (incoming.id === s.project.id && incoming.updatedAt <= s.project.updatedAt) return;

      const activeRoomId = incoming.rooms.some((r) => r.id === s.activeRoomId)
        ? s.activeRoomId
        : incoming.rooms[0].id;
      useAppStore.setState({
        project: incoming,
        activeRoomId,
        past: [...s.past, s.project].slice(-HISTORY_LIMIT),
        future: [],
      });
      // Выделение могло ссылаться на удалённую стену или проём — стор его проверит.
      useAppStore.getState().select(s.selection);

      const now = Date.now();
      if (now - lastToast > TOAST_EVERY_MS) {
        lastToast = now;
        toast("Проект изменён в другой вкладке — показываем свежую версию", "info", {
          action: { label: "Отменить", onClick: () => useAppStore.getState().undo() },
        });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}
