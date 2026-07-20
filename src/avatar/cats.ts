export const CAT_BREEDS = ["kijitora", "chatora", "white", "black"] as const;
export type CatBreed = (typeof CAT_BREEDS)[number];

export const CAT_POSES = ["idle", "attack", "hit", "hiss", "defeat"] as const;
export type CatPose = (typeof CAT_POSES)[number];

const POSE_FRAME: Record<CatPose, string> = {
  idle: "00",
  attack: "01",
  hit: "02",
  hiss: "03",
  defeat: "04",
};

export interface CatAssignment {
  readonly player: CatBreed;
  readonly enemy: CatBreed;
}

function hashString(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/**
 * Assigns two different cats to two stable player IDs.
 * Sorting the IDs makes LAN PvP mirrored: host.self === guest.opponent.
 */
export function assignDistinctCats(seed: string, playerId: string, enemyId: string): CatAssignment {
  // Keep the ordering independent of the device locale so a Japanese phone and
  // an English PC derive the same host/guest assignment.
  const orderedIds = playerId <= enemyId ? [playerId, enemyId] : [enemyId, playerId];
  const pairKey = `poker-cats-v1|${seed}|${orderedIds[0]}|${orderedIds[1]}`;
  const firstIndex = hashString(pairKey) % CAT_BREEDS.length;
  const secondOffset = 1 + (hashString(`${pairKey}|second`) % (CAT_BREEDS.length - 1));
  const secondIndex = (firstIndex + secondOffset) % CAT_BREEDS.length;
  const byPlayerId = new Map<string, CatBreed>([
    [orderedIds[0], CAT_BREEDS[firstIndex]],
    [orderedIds[1], CAT_BREEDS[secondIndex]],
  ]);

  return {
    player: byPlayerId.get(playerId) ?? CAT_BREEDS[firstIndex],
    enemy: byPlayerId.get(enemyId) ?? CAT_BREEDS[secondIndex],
  };
}

export function createLocalCatSeed() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function catFramePath(breed: CatBreed, pose: CatPose) {
  return `${import.meta.env.BASE_URL}assets/cats/v1/frames/${breed}/jumping/${POSE_FRAME[pose]}.png`;
}
