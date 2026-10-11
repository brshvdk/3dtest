import { beforeEach, describe, expect, it } from "vitest";
import { createProject } from "../../domain/project";
import type { Project } from "../../domain/types";
import { MARK_KEY, STORE_KEY, createTabSync, type TabSync } from "../tabSync";

/**
 * Модель браузера: общее localStorage и очередь событий storage, которые
 * доставляются другим вкладкам, когда тест скажет (фоновые вкладки
 * получают их с задержкой — в этом весь смысл проверок на эхо).
 */
class Browser {
  data = new Map<string, string>();
  queue: { to: Tab; key: string; value: string }[] = [];
  tabs: Tab[] = [];

  storage(from: Tab) {
    return {
      getItem: (k: string) => this.data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (this.data.get(k) === v) return; // как в браузере: то же значение — без события
        this.data.set(k, v);
        for (const t of this.tabs) if (t !== from) this.queue.push({ to: t, key: k, value: v });
      },
    };
  }

  /** Доставить события (все или только вкладке to), по порядку записи. */
  deliver(to?: Tab) {
    const rest: typeof this.queue = [];
    const now = this.queue;
    this.queue = [];
    for (const e of now) {
      if (to && e.to !== to) rest.push(e);
      else e.to.sync.onStorage(e.key, e.value);
    }
    this.queue = [...rest, ...this.queue];
  }

  /** Вынуть из очереди события записи проекта для вкладки (придержать «эхо»). */
  hold(to: Tab): typeof this.queue {
    const held = this.queue.filter((e) => e.to === to && e.key === STORE_KEY);
    this.queue = this.queue.filter((e) => !held.includes(e));
    return held;
  }
}

let clock = 1_700_000_000_000;

class Tab {
  project: Project;
  past: Project[] = [];
  future: Project[] = [];
  applied = 0;
  sync: TabSync;

  constructor(
    public browser: Browser,
    public name: string,
    project: Project,
    throttleMs = 0,
  ) {
    this.project = project;
    browser.tabs.push(this);
    this.sync = createTabSync({
      tab: name,
      storage: browser.storage(this),
      current: () => this.project,
      apply: (p) => {
        this.applied++;
        this.past.push(this.project);
        this.future = [];
        this.project = p;
      },
      throttleMs,
    });
  }

  edit(name: string) {
    this.past.push(this.project);
    this.future = [];
    this.project = { ...this.project, name, updatedAt: ++clock };
    this.sync.authored(this.project);
    return this;
  }
  undo() {
    const t = this.past.pop()!;
    this.future.unshift(this.project);
    this.project = t;
    this.sync.authored(t);
    return this;
  }
  redo() {
    const t = this.future.shift()!;
    this.past.push(this.project);
    this.project = t;
    this.sync.authored(t);
    return this;
  }
  /** Отложенная запись стора: проект + своё состояние вида (у вкладок оно разное). */
  persist() {
    this.browser
      .storage(this)
      .setItem(STORE_KEY, JSON.stringify({ state: { project: this.project, view: this.name }, version: 1 }));
    return this;
  }
}

let browser: Browser;
let A: Tab;
let B: Tab;

beforeEach(() => {
  browser = new Browser();
  const start = { ...createProject({ name: "v0" }), updatedAt: ++clock };
  A = new Tab(browser, "A", start);
  B = new Tab(browser, "B", JSON.parse(JSON.stringify(start)) as Project);
  A.persist();
  browser.queue = [];
});

describe("синхронизация вкладок", () => {
  it("правка в A доходит до B", () => {
    A.edit("v1").persist();
    browser.deliver();
    expect(B.project.name).toBe("v1");
    expect(B.past[B.past.length - 1]?.name).toBe("v0");
  });

  it("«Отменить» и «Повторить» в A доходят до B, хотя updatedAt у отменённой версии старее", () => {
    A.edit("v1").persist();
    browser.deliver();
    A.undo().persist();
    browser.deliver();
    expect(B.project.name).toBe("v0");
    A.redo().persist();
    browser.deliver();
    expect(B.project.name).toBe("v1");
  });

  it("«Отменить» в B после принятой правки возвращает обе вкладки", () => {
    A.edit("v1").persist();
    browser.deliver();
    B.persist(); // эхо принятого проекта
    browser.deliver();
    B.undo().persist();
    browser.deliver();
    expect(B.project.name).toBe("v0");
    expect(A.project.name).toBe("v0");
  });

  it("запоздалое эхо из B не откатывает следующую правку A", () => {
    A.edit("v1").persist();
    browser.deliver();
    B.persist(); // B сохраняет принятый v1…
    const echo = browser.hold(A); // …но до A это дойдёт позже
    A.edit("v2").persist();
    for (const e of echo) A.sync.onStorage(e.key, e.value);
    expect(A.project.name).toBe("v2");
    browser.deliver();
    expect(B.project.name).toBe("v2");
    expect(A.applied).toBe(0);
  });

  it("две отмены подряд в A: запоздалое эхо промежуточной версии не возвращает её", () => {
    A.edit("v1").persist();
    browser.deliver();
    A.edit("v2").persist();
    browser.deliver();
    B.persist();
    const echo = browser.hold(A); // эхо v2
    A.undo().undo().persist(); // → v0
    for (const e of echo) A.sync.onStorage(e.key, e.value);
    expect(A.project.name).toBe("v0");
    browser.deliver();
    expect(B.project.name).toBe("v0");
    B.persist();
    browser.deliver();
    expect(A.project.name).toBe("v0");
    expect(A.applied).toBe(0);
  });

  it("эхо успело перезаписать хранилище раньше, чем B обработала правку A, — правка не теряется", () => {
    A.edit("v1").persist();
    browser.deliver();
    A.edit("v2").persist(); // событие для B в очереди
    B.persist(); // B пишет эхо v1 поверх v2
    browser.deliver(B);
    expect(B.project.name).toBe("v2");
    B.persist(); // эхо v2 — в хранилище снова свежая версия
    browser.deliver();
    expect(A.project.name).toBe("v2");
    expect(JSON.parse(browser.data.get(STORE_KEY)!).state.project.name).toBe("v2");
  });

  it("запись проекта пришла раньше отметки — принимаем по отметке", () => {
    const C = new Tab(browser, "C", JSON.parse(JSON.stringify(A.project)) as Project, 10_000);
    C.edit("c0").persist(); // первая отметка пишется сразу
    browser.deliver(A);
    expect(A.project.name).toBe("c0");
    C.edit("c1").persist(); // следующая отложена (троттлинг), а проект уже записан
    browser.deliver(A);
    expect(A.project.name).toBe("c0");
    C.sync.flush();
    browser.deliver(A);
    expect(A.project.name).toBe("c1");
  });

  it("нет пинг-понга: каждая вкладка принимает правку один раз", () => {
    for (let i = 1; i <= 5; i++) {
      A.edit(`v${i}`).persist();
      browser.deliver();
      B.persist();
      browser.deliver();
    }
    A.undo().undo().persist();
    browser.deliver();
    B.persist();
    browser.deliver();
    expect(A.project.name).toBe("v3");
    expect(B.project.name).toBe("v3");
    expect(A.applied).toBe(0);
    expect(B.applied).toBe(6); // 5 правок + одна запись после двух отмен
  });

  it("вкладка без отметок (старая версия): принимаем только более свежий updatedAt", () => {
    browser.data.delete(MARK_KEY);
    const old = (p: Project) =>
      browser
        .storage(null as unknown as Tab)
        .setItem(STORE_KEY, JSON.stringify({ state: { project: p, view: "old" }, version: 1 }));
    old({ ...A.project, name: "old-new", updatedAt: ++clock });
    browser.deliver(A);
    expect(A.project.name).toBe("old-new");
    old({ ...A.project, name: "old-stale", updatedAt: clock - 10 });
    browser.deliver(A);
    expect(A.project.name).toBe("old-new");
  });

  it("мусор в хранилище и в отметке не ломает вкладку", () => {
    A.sync.onStorage(STORE_KEY, "{not json");
    A.sync.onStorage(STORE_KEY, JSON.stringify({ state: { project: { rooms: "x" } } }));
    browser.data.set(MARK_KEY, "{oops");
    A.sync.onStorage(MARK_KEY, "{oops");
    expect(A.project.name).toBe("v0");
    expect(A.applied).toBe(0);
  });
});
