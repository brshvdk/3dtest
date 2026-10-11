/**
 * Проверки истории правок. undo/redo возвращают снимок из истории как новую
 * ревизию проекта: содержимое — те же объекты (комнаты, настройки), а
 * updatedAt — время перехода. Поэтому «та же версия» — это совпадение всех
 * полей, кроме updatedAt, по ссылке, и updatedAt не старее снимка.
 */
import { expect } from "vitest";
import type { Project } from "../../domain/types";

export function expectSameVersion(actual: Project, expected: Project, msg = ""): void {
  if (actual === expected) return;
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)] as Array<keyof Project>);
  keys.delete("updatedAt");
  for (const k of keys) expect(actual[k], `${msg} поле ${k}`.trim()).toBe(expected[k]);
  expect(actual.updatedAt, `${msg} updatedAt`.trim()).toBeGreaterThanOrEqual(expected.updatedAt);
}

/** Стек истории (past/future) — те же версии в том же порядке. */
export function expectSameVersions(actual: readonly Project[], expected: readonly Project[], msg = ""): void {
  expect(actual, msg).toHaveLength(expected.length);
  actual.forEach((p, i) => expectSameVersion(p, expected[i], `${msg} #${i}`.trim()));
}
