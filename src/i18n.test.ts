import { describe, expect, it } from "vitest";

import { localizeHand, localizeSkill, translate } from "./i18n";

describe("localization", () => {
  it("interpolates Japanese and English UI messages", () => {
    expect(translate("notice.shuffled", { count: 3 }, "ja")).toBe("3枚をシャッフル！");
    expect(translate("notice.shuffled", { count: 3 }, "en")).toBe("Shuffled 3 cards!");
  });

  it("localizes both CPU strength choices", () => {
    expect(translate("cpuStrength.title", undefined, "ja")).toBe("CPUの強さを選択");
    expect(translate("cpuStrength.normalDetail", undefined, "ja")).toContain("現在と同じ速さ");
    expect(translate("cpuStrength.strongDetail", undefined, "en")).toBe("CPU acts more quickly");
  });

  it("localizes skill names without changing their game identifiers", () => {
    expect(localizeSkill("HEAL", "ja", 20)).toBe("回復 +20");
    expect(localizeSkill("HEAL", "en", 20)).toBe("HEAL +20");
    expect(localizeSkill("BLOCK", "ja")).toBe("ブロック");
  });

  it("localizes hand names from stable hand types and ranks", () => {
    expect(localizeHand("two_pair", [10, 8], "ja")).toBe("ツーペア 10/8");
    expect(localizeHand("two_pair", [10, 8], "en")).toBe("TWO PAIR 10/8");
    expect(localizeHand("royal_flush", [14], "ja")).toBe("ロイヤルフラッシュ");
  });
});
