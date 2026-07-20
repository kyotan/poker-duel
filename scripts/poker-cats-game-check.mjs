import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
const playwrightUrl = pathToFileURL(path.join(codexHome, "skills/develop-web-game/node_modules/playwright/index.mjs")).href;
const { chromium } = await import(playwrightUrl);

const outputDir = "output/web-game/poker-cats-integration/responsive";
fs.mkdirSync(outputDir, { recursive: true });

const pairHand = [
  { suit: "spades", rank: 10 },
  { suit: "hearts", rank: 10 },
  { suit: "clubs", rank: 3 },
  { suit: "diamonds", rank: 6 },
  { suit: "spades", rank: 13 },
];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});

const scenarios = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "short-desktop", viewport: { width: 1264, height: 624 } },
  { name: "mobile-390", viewport: { width: 390, height: 844 } },
  { name: "mobile-320", viewport: { width: 320, height: 568 } },
];
const report = [];

function intersects(left, right) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

for (const scenario of scenarios) {
  const page = await browser.newPage({ viewport: scenario.viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));

  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.getByTestId("mode-cpu").click();
  await page.getByTestId("cpu-strength-normal").click();
  await page.getByTestId("start-button").click();
  await page.evaluate(() => window.advanceTime?.(5_100));
  await page.waitForTimeout(120);

  const initial = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  await page.screenshot({ path: `${outputDir}/${scenario.name}-idle.png`, fullPage: false });

  await page.evaluate((hand) => {
    window.__POKER_DUEL_TEST__?.reset({
      phase: "playing",
      player: { hand },
      enemy: { blockRemainingMs: 5_000 },
      cpuPaused: true,
    });
  }, pairHand);
  await page.getByTestId("role-candidate").first().click();
  await page.evaluate(() => window.advanceTime?.(100));
  await page.waitForTimeout(180);
  const blocked = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  await page.screenshot({ path: `${outputDir}/${scenario.name}-blocked.png`, fullPage: false });

  await page.evaluate((hand) => {
    window.__POKER_DUEL_TEST__?.reset({
      phase: "playing",
      player: { hand },
      enemy: { hp: 100 },
      cpuPaused: true,
    });
  }, pairHand);
  await page.getByTestId("role-candidate").first().click();
  await page.evaluate(() => window.advanceTime?.(100));
  await page.waitForTimeout(180);
  const hit = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  await page.screenshot({ path: `${outputDir}/${scenario.name}-hit.png`, fullPage: false });

  await page.evaluate((hand) => {
    window.__POKER_DUEL_TEST__?.reset({
      phase: "playing",
      player: { hand },
      enemy: { hp: 5 },
      cpuPaused: true,
    });
  }, pairHand);
  await page.getByTestId("role-candidate").first().click();
  await page.evaluate(() => window.advanceTime?.(100));
  await page.waitForTimeout(180);
  const defeated = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
  await page.screenshot({ path: `${outputDir}/${scenario.name}-defeat.png`, fullPage: false });

  const layout = await page.evaluate(() => {
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const collect = (side) => {
      const info = document.querySelector(`[data-testid="${side}-info"]`);
      const avatar = info.querySelector(".fighter-info__avatar");
      const copy = info.querySelector(".fighter-info__copy");
      const status = info.querySelector(".pd-status-badge");
      const image = avatar.querySelector("img");
      const hand = document.querySelector(`[data-testid="${side}-hand"]`);
      const style = getComputedStyle(avatar);
      return {
        cat: avatar.dataset.cat,
        pose: avatar.dataset.pose,
        info: rect(info),
        avatar: rect(avatar),
        copy: rect(copy),
        status: rect(status),
        hand: rect(hand),
        imageLoaded: image.complete && image.naturalWidth === 192 && image.naturalHeight === 208,
        avatarBorderWidth: style.borderWidth,
        avatarBackground: style.backgroundColor,
      };
    };
    return {
      player: collect("player"),
      enemy: collect("enemy"),
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      verticalOverflow: document.documentElement.scrollHeight - innerHeight,
    };
  });

  const catStatusOverlap = {
    player: intersects(layout.player.avatar, layout.player.status),
    enemy: intersects(layout.enemy.avatar, layout.enemy.status),
  };
  const catHandOverlap = {
    player: intersects(layout.player.avatar, layout.player.hand),
    enemy: intersects(layout.enemy.avatar, layout.enemy.hand),
  };
  const catCopyOverlap = {
    player: intersects(layout.player.avatar, layout.player.copy),
    enemy: intersects(layout.enemy.avatar, layout.enemy.copy),
  };

  report.push({
    scenario: scenario.name,
    viewport: scenario.viewport,
    initialCats: initial.catAvatars,
    blockedCats: blocked.catAvatars,
    hitCats: hit.catAvatars,
    defeatedCats: defeated.catAvatars,
    layout,
    catStatusOverlap,
    catHandOverlap,
    catCopyOverlap,
    errors,
  });
  await page.close();
}

await browser.close();
fs.writeFileSync(`${outputDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

const failed = report.some((entry) =>
  entry.errors.length > 0
  || entry.initialCats.player.breed === entry.initialCats.enemy.breed
  || entry.initialCats.player.breed !== entry.blockedCats.player.breed
  || entry.initialCats.enemy.breed !== entry.blockedCats.enemy.breed
  || entry.blockedCats.player.pose !== "attack"
  || entry.blockedCats.enemy.pose !== "hiss"
  || entry.hitCats.player.pose !== "attack"
  || entry.hitCats.enemy.pose !== "hit"
  || entry.defeatedCats.player.pose !== "idle"
  || entry.defeatedCats.enemy.pose !== "defeat"
  || !entry.layout.player.imageLoaded
  || !entry.layout.enemy.imageLoaded
  || entry.layout.horizontalOverflow > 0
  || !entry.catStatusOverlap.player
  || !entry.catStatusOverlap.enemy
  || entry.catHandOverlap.player
  || entry.catHandOverlap.enemy
);

if (failed) process.exitCode = 1;
