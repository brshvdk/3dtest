/**
 * Недавние проекты: прежние проекты не пропадают при «Новый проект»,
 * открытии другого проекта или проекта по ссылке — они уходят в список
 * (localStorage, merka:projects) и открываются снова из меню проекта.
 */
import { useSyncExternalStore } from "react";
import { migrateProject } from "../domain/project";
import type { Project } from "../domain/types";
import { useAppStore } from "../state/store";
import { toast } from "../ui/kit";

const KEY = "merka:projects";
const LIMIT = 8;
const CHANGE = "merka:projects-change";

export interface ArchivedProject {
  project: Project;
  /** Когда проект ушёл в список, мс. */
  savedAt: number;
}

let cache: { raw: string | null; list: ArchivedProject[] } = { raw: null, list: [] };

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Список (новые сверху). Ссылка стабильна, пока хранилище не изменилось. */
export function readArchive(): ArchivedProject[] {
  const raw = readRaw();
  if (raw === cache.raw) return cache.list;
  let list: ArchivedProject[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      for (const e of parsed) {
        const project = migrateProject((e as { project?: unknown })?.project);
        const savedAt = Number((e as { savedAt?: unknown })?.savedAt);
        if (project) list.push({ project, savedAt: Number.isFinite(savedAt) ? savedAt : 0 });
      }
    }
  } catch {
    list = [];
  }
  cache = { raw, list };
  return list;
}

function writeArchive(list: ArchivedProject[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(CHANGE));
    return true;
  } catch {
    return false;
  }
}

/** Кладёт проект в начало списка (тот же id — заменяет). false — не удалось сохранить. */
export function archiveProject(project: Project): boolean {
  const list = readArchive().filter((e) => e.project.id !== project.id);
  return writeArchive([{ project, savedAt: Date.now() }, ...list].slice(0, LIMIT));
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) cb();
  };
  window.addEventListener(CHANGE, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useArchive(): ArchivedProject[] {
  return useSyncExternalStore(subscribe, readArchive, () => []);
}

const undoAction = { label: "Вернуть", onClick: () => useAppStore.getState().undo() };

/** «Новый проект»: текущий уходит в «Недавние проекты». */
export function startNewProject(): void {
  const current = useAppStore.getState().project;
  if (!archiveProject(current)) {
    const ok = window.confirm(
      `Начать новый проект? Браузер не даёт сохранить «${current.name}» в списке недавних: ` +
        "после перезагрузки страницы его не вернуть. Если он нужен — сначала скопируйте ссылку «Поделиться».",
    );
    if (!ok) return;
  }
  useAppStore.getState().newProject();
  toast(`Создан новый проект. «${current.name}» — в меню проекта`, "info", { action: undoAction });
}

/**
 * Открывает проект из списка; текущий уходит в список. Открытый остаётся в
 * списке (в меню он не показывается, пока открыт) — после «Вернуть» и
 * перезагрузки его снова можно открыть.
 */
export function openArchived(id: string): void {
  const entry = readArchive().find((e) => e.project.id === id);
  if (!entry) return;
  archiveProject(useAppStore.getState().project);
  useAppStore.getState().loadProject(entry.project);
  toast(`Открыт проект «${entry.project.name}»`, "info", { action: undoAction });
}
