/**
 * Итог: сколько купить, список покупок, как посчитали, раскрой планок,
 * фурнитура и крепёж, сводка комнаты. Правая колонка на широком экране
 * и вкладка «Итог» на узком.
 *
 * Смета — самый тяжёлый расчёт в приложении, поэтому панель работает с
 * ОТЛОЖЕННЫМ проектом (useDeferredValue): при перетаскивании стен план
 * обновляется сразу, а итог — следом, в фоновой отрисовке. Тело панели
 * мемоизировано по смете, поэтому срочная отрисовка тут почти бесплатна.
 */
import { memo, useDeferredValue, useMemo } from "react";
import type { ProductEstimate, ProjectEstimate } from "../domain/estimate";
import { getColorName } from "../domain/skirtingCatalog";
import type { Project, Room } from "../domain/types";
import { formatMoney, formatNumber, pluralize } from "../domain/units";
import { ProfileIcon } from "../panels/ProfileIcon";
import { getEstimate } from "../state/hooks";
import { useAppStore } from "../state/store";
import { Button, Callout, Icon, IconButton, Section, toast, useIsMobile } from "../ui/kit";
import { CutPlan } from "./CutPlan";
import { CalcDetails, ExtraDetails } from "./ResultsDetails";
import { countText, joinRu, meters, pctText, stockText, typo, unitForms } from "./format";
import { buildOrderText } from "./orderText";
import { CAN_PRINT, CAN_SHARE } from "../app/env";
import "./results.css";

/* ------------------------------ Действия ------------------------------ */

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Нет доступа к Clipboard API (http, старый браузер) — старый способ.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Текст заказа по актуальному (не отложенному) проекту — на момент нажатия. */
function currentOrderText(): { text: string; title: string } {
  const { project } = useAppStore.getState();
  return { text: buildOrderText(getEstimate(project), project), title: `Плинтус — ${project.name}` };
}

async function copyOrder() {
  const { text } = currentOrderText();
  if (await copyText(text)) toast("Список скопирован — вставьте его в мессенджер или заметки");
  else toast("Не удалось скопировать — браузер не дал доступ к буферу обмена", "warning");
}

const canShare = CAN_SHARE && typeof navigator !== "undefined" && typeof navigator.share === "function";

async function shareOrder() {
  const { text, title } = currentOrderText();
  try {
    await navigator.share({ title, text });
  } catch (e) {
    // Отмена пользователем — не ошибка.
    if ((e as Error)?.name !== "AbortError") void copyOrder();
  }
}

const printSheet = () => window.print();

/* ----------------------------- «Нужно купить» ----------------------------- */

function roomsLabel(pe: ProductEstimate): string {
  const names = pe.rooms.map((r) => r.roomName);
  if (names.length <= 2) return names.join(", ");
  return `${names.length} ${pluralize(names.length, ["комната", "комнаты", "комнат"])}`;
}

const HeroCard = memo(function HeroCard({ pe, reservePct }: { pe: ProductEstimate; reservePct: number }) {
  const setPanelTab = useAppStore((s) => s.setPanelTab);
  const p = pe.product;
  const forms = unitForms(p);

  if (pe.netLength <= 0) {
    return (
      <section className="rs-hero rs-hero--none" aria-label="Итог">
        <div className="rs-hero__top">
          <span className="rs-overline">Итог</span>
          <span className="rs-hero__rooms">{roomsLabel(pe)}</span>
        </div>
        <div className="rs-hero__none">
          <span className="rs-hero__none-icon">
            <Icon name="check" size={20} strokeWidth={2.2} />
          </span>
          <div>
            <div className="rs-hero__none-title">Плинтус не нужен</div>
            <p className="rs-hero__none-text">
              Весь периметр занят дверями, проёмами и мебелью — класть плинтус некуда.{" "}
              <button type="button" className="rs-link" onClick={() => setPanelTab("openings")}>
                Проверить проёмы
              </button>
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rs-hero" aria-label="Нужно купить">
      <div className="rs-hero__top">
        <span className="rs-overline">Нужно купить</span>
        <span className="rs-hero__rooms" title={pe.rooms.map((r) => r.roomName).join(", ")}>
          {roomsLabel(pe)}
        </span>
      </div>

      <div className="rs-hero__count">
        <span className="rs-hero__num num" key={pe.planksToOrder}>
          {formatNumber(pe.planksToOrder, 0)}
        </span>
        <span className="rs-hero__unit">{pluralize(pe.planksToOrder, forms)}</span>
      </div>
      <div className="rs-hero__sub num">
        по {stockText(p.length)} ({stockText(pe.lengthToOrder)})
      </div>

      <div className="rs-hero__product">
        <div className="rs-hero__icon">
          <ProfileIcon product={p} size={46} />
        </div>
        <div className="rs-hero__pinfo">
          <div className="rs-hero__pname">{typo(p.name)}</div>
          <div className="rs-hero__pmeta">
            <span className="rs-hero__tag">
              <span className="rs-dot" style={{ background: p.color }} aria-hidden />
              {getColorName(p)}
            </span>
            <span className="rs-hero__tag">
              <Icon name={p.cornerMethod === "miter" ? "scissors" : "corner"} size={12} />
              {p.cornerMethod === "miter" ? "углы — запил 45°" : "углы — фурнитура"}
            </span>
          </div>
        </div>
        <IconButton
          icon="edit"
          size="sm"
          className="rs-hero__change"
          label="Выбрать другой плинтус, цвет или длину планки"
          onClick={() => setPanelTab("skirting")}
        />
      </div>

      <dl className="rs-hero__stats">
        <div>
          <dt>Чистая длина</dt>
          <dd className="num">{meters(pe.netLength)}</dd>
        </div>
        <div>
          <dt>Запас {pctText(reservePct)}</dt>
          <dd className="num">{pe.reservePlanks > 0 ? `+${countText(pe.reservePlanks, ["шт", "шт", "шт"])}` : "нет"}</dd>
        </div>
        <div>
          <dt>Стоимость</dt>
          <dd className="num rs-hero__cost">{pe.cost > 0 ? formatMoney(pe.cost) : "—"}</dd>
        </div>
      </dl>
    </section>
  );
});

/* ----------------------------- Пустые состояния ----------------------------- */

function AllDisabled({ room }: { room: Room }) {
  const updateRoom = useAppStore((s) => s.updateRoom);
  return (
    <section className="rs-empty">
      <span className="rs-empty__icon">
        <Icon name="skirting" size={26} />
      </span>
      <h3 className="rs-empty__title">Плинтус не считается</h3>
      <p className="rs-empty__text">
        Во всех комнатах выключен расчёт плинтуса. Включите его — и здесь появится, сколько и чего купить.
      </p>
      <Button variant="primary" icon="check" onClick={() => updateRoom({ skirtingEnabled: true })}>
        Включить для комнаты «{room.name}»
      </Button>
    </section>
  );
}

function ActiveRoomSkipped({ room }: { room: Room }) {
  const updateRoom = useAppStore((s) => s.updateRoom);
  return (
    <div className="rs-skipped">
      <Callout tone="info">
        <span>
          Комната «{room.name}» не учитывается в расчёте.{" "}
          <button type="button" className="rs-link" onClick={() => updateRoom({ skirtingEnabled: true })}>
            Учитывать
          </button>
        </span>
      </Callout>
    </div>
  );
}

/* ------------------------------ Список покупок ------------------------------ */

const OrderTable = memo(function OrderTable({ estimate }: { estimate: ProjectEstimate }) {
  const products = estimate.products.filter((pe) => pe.lines.length > 0);
  const multi = products.length > 1;
  const count = products.reduce((s, pe) => s + pe.lines.length, 0);
  return (
    <Section
      title="Список покупок"
      subtitle={`${formatNumber(count, 0)} ${pluralize(count, ["позиция", "позиции", "позиций"])} · цены примерные`}
      className="rs-order"
    >
      <div className="rs-table-wrap">
        <table className="rs-table">
          <thead>
            <tr>
              <th scope="col">Наименование</th>
              <th scope="col" className="rs-table__n">
                Кол-во
              </th>
              <th scope="col" className="rs-table__n rs-table__price">
                Цена
              </th>
              <th scope="col" className="rs-table__n">
                Сумма
              </th>
            </tr>
          </thead>
          {products.map((pe) => (
            <tbody key={pe.product.id}>
              {multi ? (
                <tr className="rs-table__group">
                  <th scope="rowgroup" colSpan={4}>
                    {pe.product.shortName}
                    <span className="faint"> · {joinRu(pe.rooms.map((r) => r.roomName))}</span>
                  </th>
                </tr>
              ) : null}
              {pe.lines.map((l) => (
                <tr key={l.id} className={l.kind === "plank" ? "is-main" : undefined}>
                  <td>
                    <div className="rs-table__name">{typo(l.name)}</div>
                    <div className="rs-table__note">
                      {/* Узкая колонка: цена за единицу — здесь, а не отдельным столбцом. */}
                      <span className="rs-table__each num">
                        {formatMoney(l.unitPrice)}/{l.unit}
                        {l.note ? " · " : ""}
                      </span>
                      {l.note ? typo(l.note) : null}
                    </div>
                  </td>
                  <td className="rs-table__n num">
                    {formatNumber(l.qty, 2, { trim: true })}
                    <span className="rs-table__unit"> {l.unit}</span>
                  </td>
                  <td className="rs-table__n rs-table__price num">{formatMoney(l.unitPrice)}</td>
                  <td className="rs-table__n rs-table__sum num">{formatMoney(l.total)}</td>
                </tr>
              ))}
              {multi ? (
                <tr className="rs-table__subtotal">
                  <td colSpan={3}>Сумма {pe.product.shortName}</td>
                  <td className="rs-table__n num">{formatMoney(pe.cost)}</td>
                </tr>
              ) : null}
            </tbody>
          ))}
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Итого
              </th>
              <td className="rs-table__n num">{formatMoney(estimate.totalCost)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="rs-actions">
        <Button variant="primary" icon="copy" onClick={copyOrder}>
          Скопировать список
        </Button>
        {CAN_PRINT ? (
          <Button icon="print" onClick={printSheet}>
            Печать / PDF
          </Button>
        ) : null}
        {canShare ? <Button icon="share" onClick={shareOrder} aria-label="Отправить список" title="Отправить список" /> : null}
      </div>
    </Section>
  );
});

/* -------------------------------- Панель -------------------------------- */

const ResultsBody = memo(function ResultsBody({
  project,
  estimate,
  activeRoomId,
  isMobile,
}: {
  project: Project;
  estimate: ProjectEstimate;
  activeRoomId: string;
  isMobile: boolean;
}) {
  const activeRoom = project.rooms.find((r) => r.id === activeRoomId) ?? project.rooms[0];
  const products = estimate.products;
  const withLines = products.filter((pe) => pe.lines.length > 0);
  const withBars = products.filter((pe) => pe.cutPlan.bars.length > 0);
  // Пустые состояния уже объясняют «всё выключено» и «весь периметр занят» — не дублируем их предупреждением.
  const emptyRooms = new Set(
    products.filter((pe) => pe.netLength <= 0).flatMap((pe) => pe.rooms.map((r) => `${r.roomName}: `)),
  );
  const warnings =
    products.length === 0
      ? []
      : [...new Set(estimate.warnings)].filter(
          (w) => !(/Весь периметр занят/.test(w) && [...emptyRooms].some((prefix) => w.startsWith(prefix))),
        );
  const skippedActive = products.length > 0 && activeRoom && !activeRoom.skirtingEnabled;
  // Номера комнат в раскрое — те же, что на печатном листе (по порядку в проекте).
  const roomNumbers = useMemo(() => new Map(project.rooms.map((r, i) => [r.id, i + 1])), [project.rooms]);

  return (
    <div className="rs-panel">
      {skippedActive ? <ActiveRoomSkipped room={activeRoom} /> : null}

      {products.length === 0 ? (
        <AllDisabled room={activeRoom} />
      ) : (
        <div className="rs-heroes">
          {products.map((pe) => (
            <HeroCard key={pe.product.id} pe={pe} reservePct={project.skirting.reservePct} />
          ))}
          {withLines.length > 1 ? (
            <div className="rs-grand">
              <span className="rs-grand__label">
                Итого по проекту
                <span className="rs-grand__sub">
                  {countText(withLines.length, ["вид", "вида", "видов"])} плинтуса ·{" "}
                  {countText(estimate.lines.length, ["позиция", "позиции", "позиций"])}
                </span>
              </span>
              <strong className="num">{formatMoney(estimate.totalCost)}</strong>
            </div>
          ) : null}
        </div>
      )}

      {warnings.length ? (
        <div className="rs-warnings">
          {warnings.map((w) => (
            <Callout key={w} tone="warning">
              {w}
            </Callout>
          ))}
        </div>
      ) : null}

      {withLines.length ? <OrderTable estimate={estimate} /> : null}

      {products.length ? (
        <CalcDetails project={project} estimate={estimate} defaultOpen={!isMobile} />
      ) : null}

      {withBars.map((pe) => (
        <Section
          key={pe.product.id}
          title={pe.product.material === "ceramic" ? "Раскрой элементов" : "Раскрой планок"}
          subtitle={withBars.length > 1 ? `${pe.product.shortName} · ${joinRu(pe.rooms.map((r) => r.roomName))}` : undefined}
          actions={<Icon name="scissors" size={18} className="rs-section-icon" />}
          className="rs-cut-section"
        >
          <CutPlan estimate={pe} showRoomNames={estimate.rooms.length > 1} roomNumbers={roomNumbers} />
        </Section>
      ))}

      <ExtraDetails project={project} estimate={estimate} activeRoom={activeRoom} />

      <p className="rs-footnote">
        Цены ориентировочные. Поставьте цены своего магазина в шаге «Плинтус» — итог пересчитается сразу.
      </p>
    </div>
  );
});

export function ResultsPanel(): JSX.Element {
  const live = useAppStore((s) => s.project);
  const project = useDeferredValue(live);
  const activeRoomId = useAppStore((s) => s.activeRoomId);
  const isMobile = useIsMobile();
  const estimate = getEstimate(project);
  return <ResultsBody project={project} estimate={estimate} activeRoomId={activeRoomId} isMobile={isMobile} />;
}
