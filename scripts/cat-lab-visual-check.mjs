import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
const playwrightUrl = pathToFileURL(path.join(codexHome, "skills/develop-web-game/node_modules/playwright/index.mjs")).href;
const { chromium } = await import(playwrightUrl);

const outputDir = "output/web-game/cat-lab/responsive-check";
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});

const scenarios = [
  { name: "desktop-black-hiss", viewport: { width: 1440, height: 900 }, breed: "black", action: "hiss" },
  { name: "mobile-white-defeat", viewport: { width: 390, height: 844 }, breed: "white", action: "defeat" },
];
const results = [];

for (const scenario of scenarios) {
  const page = await browser.newPage({ viewport: scenario.viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));

  await page.goto("http://127.0.0.1:5174/cat-lab/index.html", { waitUntil: "networkidle" });
  await page.locator(`button[data-breed="${scenario.breed}"]`).click();
  await page.locator(`button[data-action-button="${scenario.action}"]`).click();
  await page.waitForTimeout(320);
  await page.screenshot({ path: `${outputDir}/${scenario.name}.png`, fullPage: false });

  results.push(await page.evaluate(({ name, errors }) => {
    const hero = document.querySelector("#hero-cat");
    const selectedBreed = document.querySelector(".breed-button.is-selected")?.dataset.breed;
    const selectedAction = document.querySelector(".action-button.is-selected")?.dataset.actionButton;
    return {
      name,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      selectedBreed,
      selectedAction,
      breedButtonCount: document.querySelectorAll(".breed-button").length,
      actionButtonCount: document.querySelectorAll(".action-button").length,
      librarySpriteCount: document.querySelectorAll(".pose-row img").length,
      heroNaturalSize: hero ? { width: hero.naturalWidth, height: hero.naturalHeight } : null,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      failedImages: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src),
      errors,
    };
  }, { name: scenario.name, errors }));
  await page.close();
}

await browser.close();
fs.writeFileSync(`${outputDir}/report.json`, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));

if (results.some((result) => result.errors.length || result.failedImages.length || result.horizontalOverflow > 0)) {
  process.exitCode = 1;
}
