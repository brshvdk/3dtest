/** Вкладки комнат проекта над холстом: быстрое переключение и «+ комната». */
import { useAppStore } from "../state/store";
import { useEstimate } from "../state/hooks";
import { formatLength } from "../domain/units";
import { Icon } from "../ui/kit";

export function RoomTabs() {
  const rooms = useAppStore((s) => s.project.rooms);
  const activeRoomId = useAppStore((s) => s.activeRoomId);
  const setActiveRoom = useAppStore((s) => s.setActiveRoom);
  const addRoom = useAppStore((s) => s.addRoom);
  const estimate = useEstimate();

  return (
    <div className="room-tabs scroll-x" role="tablist" aria-label="Комнаты">
      {rooms.map((r) => {
        const res = estimate.rooms.find((x) => x.roomId === r.id);
        return (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={r.id === activeRoomId}
            className={`room-tab${r.id === activeRoomId ? " is-active" : ""}${
              r.skirtingEnabled ? "" : " is-muted"
            }`}
            onClick={() => setActiveRoom(r.id)}
            title={r.skirtingEnabled ? undefined : "Комната не учитывается в расчёте"}
          >
            <span className="room-tab__name">{r.name}</span>
            {res ? (
              <span className="room-tab__meta num">{formatLength(res.netLength, "m", 1)}</span>
            ) : null}
          </button>
        );
      })}
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
