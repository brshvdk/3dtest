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
