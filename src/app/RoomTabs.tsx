/**
 * Вкладки комнат проекта над холстом: быстрое переключение и «+ комната».
 * Полоса прокручивается колесом мыши и сама показывает активную вкладку;
 * кнопка добавления — вне прокрутки, поэтому видна всегда.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppStore } from "../state/store";
import { useEstimate } from "../state/hooks";
import { formatLength } from "../domain/units";
import { Icon, rovingKeyDown } from "../ui/kit";

export function RoomTabs() {
  const rooms = useAppStore((s) => s.project.rooms);
  const activeRoomId = useAppStore((s) => s.activeRoomId);
  const setActiveRoom = useAppStore((s) => s.setActiveRoom);
  const addRoom = useAppStore((s) => s.addRoom);
  const estimate = useEstimate();
  const listRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((o) => (o.left === left && o.right === right ? o : { left, right }));
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Колесо мыши (вертикальное) прокручивает полосу по горизонтали.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [measure]);

  // Активная вкладка всегда в зоне видимости (новая комната, выбор на плане).
  // Ширина вкладки меняется, когда приходит отложенная смета (длина) или
  // меняется имя, — следим за ней, пока вкладка активна.
  useLayoutEffect(() => {
    const el = listRef.current;
    const tab = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !tab) return;
    const reveal = () => {
      const pad = 24;
      // .room-tabs — offsetParent (position: relative): координаты в прокручиваемом содержимом.
      const l = tab.offsetLeft;
      const r = l + tab.offsetWidth;
      if (l - pad < el.scrollLeft) el.scrollLeft = Math.max(0, l - pad);
      else if (r + pad > el.scrollLeft + el.clientWidth) el.scrollLeft = r + pad - el.clientWidth;
      measure();
    };
    reveal();
    const ro = new ResizeObserver(reveal);
    ro.observe(tab);
    return () => ro.disconnect();
  }, [activeRoomId, rooms.length, measure]);

  return (
    <div className="room-tabs-wrap">
      <div
        ref={listRef}
        className={`room-tabs scroll-x${overflow.left ? " has-more-left" : ""}${
          overflow.right ? " has-more-right" : ""
        }`}
        role="tablist"
        aria-label="Комнаты"
        onScroll={measure}
        onKeyDown={rovingKeyDown}
      >
        {rooms.map((r) => {
          const res = estimate.rooms.find((x) => x.roomId === r.id);
          const active = r.id === activeRoomId;
          const length = res ? formatLength(res.netLength, "m", 2) : null;
          return (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`room-tab${active ? " is-active" : ""}${r.skirtingEnabled ? "" : " is-muted"}`}
              onClick={() => setActiveRoom(r.id)}
              title={
                r.skirtingEnabled
                  ? length
                    ? `${r.name}: плинтус по стенам ${length}`
                    : r.name
                  : `${r.name}: не учитывается в расчёте`
              }
            >
              <span className="room-tab__name">{r.name}</span>
              {length ? (
                <span className="room-tab__meta num">
                  <Icon name="skirting" size={12} strokeWidth={2} />
                  <span className="visually-hidden">плинтус </span>
                  {length}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="room-tab room-tab--add"
        onClick={() => addRoom("rect")}
        title="Добавить комнату"
        aria-label="Добавить комнату"
      >
        <Icon name="plus" size={16} />
        <span className="room-tab__name">Комната</span>
      </button>
    </div>
  );
}
