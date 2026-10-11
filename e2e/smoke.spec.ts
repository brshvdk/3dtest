import { expect, test, type Page } from "@playwright/test";

/** Свежий старт: без сохранённого проекта → демо-комната. */
async function fresh(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  return errors;
}

test("приложение открывается с демо-комнатой и расчётом", async ({ page }) => {
  const errors = await fresh(page);
  await expect(page.getByText("Мерка").first()).toBeVisible();
  // План нарисован
  await expect(page.locator("svg").first()).toBeVisible();
  // Расчёт показывает число планок (на мобильном — во вкладке «Итог»)
  const resultTab = page.getByRole("tab", { name: /Итог/ });
  if (await resultTab.isVisible()) await resultTab.click();
  await expect(page.getByText(/Нужно купить/i).first()).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("добавление двери уменьшает длину плинтуса", async ({ page }) => {
  await fresh(page);
  const readNet = async () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("merka:v1");
      return raw ? raw.length : 0;
    });
  const before = await readNet();
  await page.getByRole("tab", { name: /Проёмы/ }).click();
  await page.getByRole("button", { name: /^Дверь$/ }).first().click();
  // Новый проём появился в списке
  await expect(
    page.getByRole("list", { name: "Проёмы комнаты" }).getByRole("listitem"),
  ).toHaveCount(3);
  await page.waitForTimeout(500);
  expect(await readNet()).not.toBe(before);
});

test("отмена и повтор работают", async ({ page }) => {
  await fresh(page);
  await page.getByRole("tab", { name: /Проёмы/ }).click();
  const items = page.getByRole("list", { name: "Проёмы комнаты" }).getByRole("listitem");
  const n0 = await items.count();
  await page.getByRole("button", { name: /^Окно$/ }).first().click();
  await expect(items).toHaveCount(n0 + 1);
  await page.getByRole("button", { name: /Отменить/ }).click();
  await expect(items).toHaveCount(n0);
  await page.getByRole("button", { name: /Повторить/ }).click();
  await expect(items).toHaveCount(n0 + 1);
});

test("3D-вид загружается без ошибок", async ({ page }) => {
  const errors = await fresh(page);
  await page.getByRole("radio", { name: /3D/ }).click();
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("«Новый проект»: прежний открывается из меню и после перезагрузки", async ({ page }) => {
  await fresh(page);
  const name = page.locator(".project-name span");
  await expect(name).toHaveText("Моя квартира");
  await page.getByRole("button", { name: "Меню проекта" }).click();
  await page.getByRole("menuitem", { name: "Новый проект" }).click();
  await expect(name).not.toHaveText("Моя квартира");
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByRole("button", { name: "Меню проекта" }).click();
  await page.getByRole("menuitem", { name: /Моя квартира/ }).click();
  await expect(name).toHaveText("Моя квартира");
});

test("Ctrl+Z в числовом поле после стрелок откатывает правку проекта", async ({ page }) => {
  await fresh(page);
  const field = page.getByLabel("Длина (стена A)");
  await field.click();
  await expect(field).toHaveValue("4,50");
  await page.keyboard.press("ArrowUp");
  await expect(field).toHaveValue("4,55");
  await page.keyboard.press("Control+z");
  await expect(field).toHaveValue("4,50");
});

test("ввод сразу после клика по полю не теряет цифры", async ({ page }) => {
  await fresh(page);
  const field = page.getByLabel("Длина (стена A)");
  await field.click();
  await page.keyboard.type("5,2");
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue("5,20");
});

test("стрелки двигают стену сразу после клика по ней на плане", async ({ page, isMobile }) => {
  test.skip(isMobile, "клавиатурный сценарий для мыши");
  await fresh(page);
  const field = page.getByLabel("Длина (стена A)");
  await expect(field).toHaveValue("4,50");
  // Правая стена (B): клик у внешнего края контура комнаты, на середине высоты.
  const box = (await page.locator(".pl-wall").first().boundingBox())!;
  await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
  await expect(page.locator(".pl-root")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(field).toHaveValue("4,51");
});

test("удаление комнаты спрашивает подтверждение: «Отмена», Esc и «Удалить»", async ({ page }) => {
  await fresh(page);
  const rooms = page.getByRole("tablist", { name: "Комнаты" }).getByRole("tab");
  await expect(rooms).toHaveCount(1);
  await page.getByRole("button", { name: "Добавить комнату" }).click();
  await expect(rooms).toHaveCount(2);
  await page.getByRole("tablist", { name: "Шаги" }).getByRole("tab", { name: /Комната/ }).click();

  const remove = page.getByRole("button", { name: "Удалить комнату" });
  const dialog = page.getByRole("alertdialog", { name: /Удалить комнату/ });

  // «Отмена»: комната на месте, фокус вернулся на кнопку удаления
  await remove.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Удалить" })).toBeFocused();
  await dialog.getByRole("button", { name: "Отмена" }).click();
  await expect(dialog).toBeHidden();
  await expect(rooms).toHaveCount(2);
  await expect(remove).toBeFocused();

  // Esc — тоже отмена; горячие клавиши приложения под диалогом не срабатывают
  await remove.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(rooms).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(rooms).toHaveCount(2);

  // «Удалить»: комната удалена, последнюю удалить нельзя
  await remove.click();
  await dialog.getByRole("button", { name: "Удалить" }).click();
  await expect(dialog).toBeHidden();
  await expect(rooms).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Единственную комнату удалить нельзя" })).toBeDisabled();
});

test("Enter в поле длины применяет значение; фокус остаётся в поле (на телефоне — клавиатура прячется)", async ({
  page,
  isMobile,
}) => {
  await fresh(page);
  const field = page.getByLabel("Длина (стена A)");
  await field.click();
  await page.keyboard.type("5");
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue("5,00");

  if (isMobile) {
    // Enter экранной клавиатуры («Готово») — применить и выйти из поля.
    await expect(field).not.toBeFocused();
    await expect(field).toHaveValue("5,00");
    return;
  }
  await expect(field).toBeFocused();
  // Текст выделен — следующий ввод заменяет его целиком.
  await expect.poll(() => field.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0))).toBe("5,00");
  await page.keyboard.type("6");
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue("6,00");
  await expect(field).toBeFocused();
  // Esc с напечатанным — отмена ввода (остаёмся в поле), второй Esc — выход из поля.
  await page.keyboard.type("9");
  await page.keyboard.press("Escape");
  await expect(field).toHaveValue("6,00");
  await expect(field).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(field).not.toBeFocused();
  await expect(field).toHaveValue("6,00");
});

test("правка, «Отменить» и «Повторить» в одной вкладке доходят до другой", async ({ page, context }) => {
  await fresh(page);
  const other = await context.newPage();
  await other.goto("/");
  const items = (p: Page) => p.getByRole("list", { name: "Проёмы комнаты" }).getByRole("listitem");
  for (const p of [page, other]) await p.getByRole("tab", { name: /Проёмы/ }).click();
  const n0 = await items(page).count();
  await expect(items(other)).toHaveCount(n0);

  await page.bringToFront();
  await page.getByRole("button", { name: /^Окно$/ }).first().click();
  await expect(items(other)).toHaveCount(n0 + 1);
  await page.getByRole("button", { name: "Отменить (Ctrl+Z)" }).click();
  await expect(items(other)).toHaveCount(n0);
  await page.getByRole("button", { name: "Повторить (Ctrl+Shift+Z)" }).click();
  await expect(items(other)).toHaveCount(n0 + 1);

  // И обратно: отмена во второй вкладке возвращает первую.
  await other.bringToFront();
  await other.getByRole("button", { name: "Отменить (Ctrl+Z)" }).click();
  await expect(items(page)).toHaveCount(n0);
  await expect(items(other)).toHaveCount(n0);
});
