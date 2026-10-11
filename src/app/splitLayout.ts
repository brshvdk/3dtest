/** Меньше этого план не помещает комнату с подписями стен — режим «Оба» не предлагаем. */
const SPLIT_MIN_PANE = 360;
const SPLIT_MIN_WIDTH = 600;

/**
 * Как делить сцену w×h в режиме «Оба»: рядом (cols) или друг под другом (rows) —
 * что даёт панелям больше места по меньшей стороне; null — места на два вида нет
 * (ноутбук 1280×800, планшет, телефон): тогда показываем один план.
 */
export function splitLayout(w: number, h: number): "cols" | "rows" | null {
  const cols = Math.min(w / 2, h);
  const rows = Math.min(w, h / 2);
  if (w < SPLIT_MIN_WIDTH || Math.max(cols, rows) < SPLIT_MIN_PANE) return null;
  return cols >= rows ? "cols" : "rows";
}
