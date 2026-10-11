#!/usr/bin/env node
/**
 * Скриншот страницы + ошибки консоли (для визуальной проверки UI).
 *
 *   node scripts/shot.mjs <url> <out.png> [--w 1440] [--h 900] [--wait 1200]
 *        [--dpr 1] [--dark] [--click "<css>"]... [--eval "<js>"]... [--full]
 *
 * --click и --eval выполняются по порядку, после каждого — пауза 300 мс.
 * Печатает в stdout ошибки консоли/страницы (если есть) и "OK <out>".
 */
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
if (!url || !out) {
  console.error("usage: node scripts/shot.mjs <url> <out.png> [opts]");
  process.exit(2);
}
let w = 1440, h = 900, wait = 1200, dpr = 1, dark = false, full = false;
const steps = [];
for (let i = 2; i < args.length; i++) {
  const a = args[i];
  if (a === "--w") w = +args[++i];
  else if (a === "--h") h = +args[++i];
  else if (a === "--wait") wait = +args[++i];
  else if (a === "--dpr") dpr = +args[++i];
  else if (a === "--dark") dark = true;
  else if (a === "--full") full = true;
  else if (a === "--click") steps.push({ click: args[++i] });
  else if (a === "--eval") steps.push({ eval: args[++i] });
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: dpr,
  colorScheme: dark ? "dark" : "light",
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`[console.${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(wait);
for (const s of steps) {
  try {
    if (s.click) await page.click(s.click, { timeout: 3000 });
    if (s.eval) await page.evaluate(s.eval);
  } catch (e) {
    errors.push(`[step] ${JSON.stringify(s)}: ${e.message.split("\n")[0]}`);
  }
  await page.waitForTimeout(300);
}
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: full });
await browser.close();
for (const e of errors) console.log(e);
console.log("OK " + out);
