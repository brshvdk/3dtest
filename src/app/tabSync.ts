/**
 * Синхронизация проекта между вкладками — логика без React и без window
 * (проверяется в тестах; подключение — useCrossTabSync).
 *
 * Стор пишет проект в localStorage (merka:v1) с задержкой, другие вкладки
 * получают событие storage. Раньше вкладка принимала только проект «свежее»
 * своего по updatedAt — так отсекалось эхо (другая вкладка сохраняет принятый
 * от нас проект, и это может прийти уже после нашей следующей правки), но
 * заодно терялись «Отменить»/«Повторить»: они возвращают проект с прежним,
 * более старым updatedAt.
 *
 * Теперь вкладка, которая САМА меняет проект (правка, отмена, повтор, новый
 * проект), пишет рядом отметку merka:sync: {вкладка, номер ревизии, отпечаток
 * содержимого}. Номер — общий счётчик: следующий = последний известный + 1.
 * Проект из хранилища принимается, только если он и есть последняя такая
 * правка: отпечаток совпадает с отметкой, отметку поставила другая вкладка, и
 * её ревизия новее всего, что эта вкладка уже показывала. Эхо (повторная
 * запись принятого проекта) отметку не ставит — его отпечаток с последней
 * отметкой не совпадает, и оно отбрасывается при любом порядке событий.
 * Без отметки (вкладка старой версии) — прежнее правило по updatedAt.
 */
import { migrateProject } from "../domain/project";
import type { Project } from "../domain/types";

/** Ключ persist-хранилища стора (src/state/store.ts). */
export const STORE_KEY = "merka:v1";
/** Отметка последней правки, сделанной в какой-либо вкладке. */
export const MARK_KEY = "merka:sync";
/** Отметку пишем не чаще (перетаскивание меняет проект десятки раз в секунду). */
export const MARK_THROTTLE_MS = 100;

export interface SyncMark {
  tab: string;
  rev: number;
  stamp: string;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** FNV-1a (32 бит) по UTF-16 — отпечаток для сравнения, не криптография. */
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Отпечаток версии проекта по его JSON — ровно тому тексту, что стор кладёт
 * в localStorage (JSON.parse → JSON.stringify его не меняет).
 */
export function projectStamp(json: string, p: { id?: unknown; updatedAt?: unknown }): string {
  return `${String(p.id)}@${String(p.updatedAt)}#${hash32(json)}.${json.length}`;
}

export function parseMark(raw: string | null): SyncMark | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as Partial<SyncMark> | null;
    if (m && typeof m.tab === "string" && typeof m.stamp === "string" && Number.isFinite(m.rev)) {
      return { tab: m.tab, rev: Number(m.rev), stamp: m.stamp };
    }
  } catch {
    // мусор — как будто отметки нет
  }
  return null;
}

interface Stored {
  project: Project;
  stamp: string;
}

/** Проект из значения merka:v1; null — не разобрать. */
export function readStored(value: string | null): Stored | null {
  if (!value) return null;
  try {
    const raw = (JSON.parse(value) as { state?: { project?: unknown } })?.state?.project;
    if (!raw || typeof raw !== "object") return null;
    const project = migrateProject(raw);
    if (!project) return null;
    return { project, stamp: projectStamp(JSON.stringify(raw), raw as { id?: unknown; updatedAt?: unknown }) };
  } catch {
    return null;
  }
}

export interface TabSyncDeps {
  /** Id этой вкладки. */
  tab: string;
  storage: StorageLike | null;
  /** Проект, который сейчас открыт во вкладке. */
  current(): Project;
  /** Показать проект из другой вкладки (прежний — в историю). */
  apply(project: Project): void;
  /** Пауза между записями отметки, мс (0 — сразу). */
  throttleMs?: number;
}

export interface TabSync {
  /** Вкладка сама сменила проект: правка, отмена, повтор, новый/открытый проект. */
  authored(project: Project): void;
  /** Событие storage из другой вкладки. */
  onStorage(key: string | null, newValue: string | null): void;
  /** Записать отложенную отметку сейчас (вкладку прячут или закрывают). */
  flush(): void;
  dispose(): void;
}

export function createTabSync(deps: TabSyncDeps): TabSync {
  const { tab, storage } = deps;
  const throttleMs = deps.throttleMs ?? MARK_THROTTLE_MS;
  /** Ревизия последней правки, которую эта вкладка сделала или приняла. */
  let appliedRev = 0;
  /** Самый свежий updatedAt, что вкладка показывала (правило для вкладок без отметок). */
  let newestSeen = deps.current().updatedAt;
  let pending: Project | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWriteAt = -Infinity;
  /** Значение последнего события merka:v1 — на случай, если отметка придёт позже. */
  let lastStoreValue: string | null = null;
  let parsed: { value: string; stored: Stored | null } | null = null;
  const stamps = new WeakMap<Project, string>();
  /** Принятый проект после migrateProject может сериализоваться чуть иначе — помним исходный отпечаток. */
  const accepted = new WeakMap<Project, string>();

  const stampOf = (p: Project): string => {
    let s = stamps.get(p);
    if (!s) {
      s = projectStamp(JSON.stringify(p), p);
      stamps.set(p, s);
    }
    return s;
  };
  const isShown = (stamp: string): boolean => {
    const cur = deps.current();
    return accepted.get(cur) === stamp || stampOf(cur) === stamp;
  };
  const readMark = (): SyncMark | null => {
    try {
      return parseMark(storage?.getItem(MARK_KEY) ?? null);
    } catch {
      return null;
    }
  };
  const read = (value: string | null): Stored | null => {
    if (!value) return null;
    if (parsed?.value !== value) parsed = { value, stored: readStored(value) };
    return parsed.stored;
  };

  const cancelPending = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  const flush = () => {
    const project = pending;
    cancelPending();
    if (!project || !storage) return;
    lastWriteAt = Date.now();
    const rev = Math.max(appliedRev, readMark()?.rev ?? 0) + 1;
    try {
      storage.setItem(MARK_KEY, JSON.stringify({ tab, rev, stamp: stampOf(project) } satisfies SyncMark));
      appliedRev = rev;
    } catch {
      // Хранилище недоступно — другие вкладки увидят правку по правилу updatedAt.
    }
  };

  const authored = (project: Project) => {
    newestSeen = Math.max(newestSeen, project.updatedAt);
    pending = project;
    if (timer) return;
    const wait = throttleMs - (Date.now() - lastWriteAt);
    if (wait <= 0) flush();
    else timer = setTimeout(flush, wait);
  };

  const onStorage = (key: string | null, newValue: string | null) => {
    let candidates: (string | null)[];
    if (key === STORE_KEY) {
      lastStoreValue = newValue;
      // Именно это значение: к моменту обработки его могла перезаписать
      // другая вкладка (эхо старой версии), а правка не должна потеряться.
      candidates = [newValue];
    } else if (key === MARK_KEY) {
      // Отметка пришла позже записи проекта — проверяем то, что уже сохранено.
      let now: string | null = null;
      try {
        now = storage?.getItem(STORE_KEY) ?? null;
      } catch {
        now = null;
      }
      candidates = now === lastStoreValue ? [now] : [now, lastStoreValue];
    } else return;

    const mark = readMark();
    for (const value of candidates) {
      const stored = read(value);
      if (!stored) continue;
      if (isShown(stored.stamp)) {
        // Уже показываем эту версию (например, другая вкладка отменила правку,
        // которой мы ещё не видели) — просто запоминаем её ревизию.
        if (mark && mark.stamp === stored.stamp && mark.rev > appliedRev) appliedRev = mark.rev;
        continue;
      }
      const take = mark
        ? mark.tab !== tab && mark.rev > appliedRev && mark.stamp === stored.stamp
        : stored.project.updatedAt > newestSeen;
      if (!take) continue;
      // Своя неотправленная отметка устарела: показываем чужую правку.
      cancelPending();
      if (mark) appliedRev = mark.rev;
      newestSeen = Math.max(newestSeen, stored.project.updatedAt);
      accepted.set(stored.project, stored.stamp);
      deps.apply(stored.project);
      return;
    }
  };

  return { authored, onStorage, flush, dispose: flush };
}
