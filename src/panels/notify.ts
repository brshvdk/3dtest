/**
 * toast без повторов: одно и то же сообщение не показывается снова, пока
 * видно предыдущее (Enter + blur в поле, серия кликов по «+ Балкон»).
 */
import { toast } from "../ui/kit";

type Tone = Parameters<typeof toast>[1];

/** мс — столько живёт toast в ките. */
const TOAST_LIFE_MS = 2600;
let last: { text: string; at: number } | null = null;

export function notify(text: string, tone?: Tone): void {
  const now = Date.now();
  if (last && last.text === text && now - last.at < TOAST_LIFE_MS) return;
  last = { text, at: now };
  toast(text, tone);
}
