import { describe, expect, it } from "vitest";
import { assignDistinctCats, CAT_BREEDS, CAT_POSES, catFramePath } from "./cats";

describe("Poker Cats assignment", () => {
  it("always gives the two combatants different cats", () => {
    for (let index = 0; index < 200; index += 1) {
      const assignment = assignDistinctCats(`round-${index}`, "player", "enemy");
      expect(assignment.player).not.toBe(assignment.enemy);
    }
  });

  it("is stable and mirrors correctly between LAN seats", () => {
    const host = assignDistinctCats("ROOM42:round-3", "host-id", "guest-id");
    const hostAgain = assignDistinctCats("ROOM42:round-3", "host-id", "guest-id");
    const guest = assignDistinctCats("ROOM42:round-3", "guest-id", "host-id");

    expect(hostAgain).toEqual(host);
    expect(guest.player).toBe(host.enemy);
    expect(guest.enemy).toBe(host.player);
  });

  it("mirrors mixed-language player IDs without relying on a device locale", () => {
    const pc = assignDistinctCats("JPEN:round-1", "player-English", "プレイヤー-日本語");
    const phone = assignDistinctCats("JPEN:round-1", "プレイヤー-日本語", "player-English");

    expect(phone.player).toBe(pc.enemy);
    expect(phone.enemy).toBe(pc.player);
  });

  it("provides an existing frame path for every breed and pose", () => {
    for (const breed of CAT_BREEDS) {
      for (const pose of CAT_POSES) {
        expect(catFramePath(breed, pose)).toMatch(
          new RegExp(`assets/cats/v1/frames/${breed}/jumping/0[0-4]\\.png$`),
        );
      }
    }
  });
});
