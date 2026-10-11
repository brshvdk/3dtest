/**
 * Где запущено приложение. Сборка для встраивания (`VITE_EMBED=1`, страница
 * на claude.ai) открывается в закрытом фрейме: там не работают печать,
 * системное «Поделиться» и ссылки вида #p=…, поэтому эти кнопки скрываем.
 */
export const EMBEDDED = import.meta.env.VITE_EMBED === "1";

/** Печать / PDF через window.print(). */
export const CAN_PRINT = !EMBEDDED;
/** Ссылка на проект (#p=…) и системное меню «Поделиться». */
export const CAN_SHARE = !EMBEDDED;
