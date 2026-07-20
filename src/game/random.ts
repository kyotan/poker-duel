import type { RandomSource } from "./types";

const UINT32_RANGE = 0x1_0000_0000;

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
function normalizeSeed(seed: number | string): number {
  if (typeof seed === "string") {
    return hashSeed(seed);
  }
  if (!Number.isFinite(seed)) {
    throw new Error("Random seed must be a finite number or string.");
  }
  return seed >>> 0;
}

/**
 * Small deterministic PRNG suitable for replays, tests, and authoritative
 * game simulation. It is not intended for cryptographic secrets.
 */
export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed: number | string) {
    this.state = normalizeSeed(seed);
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  }

  getState(): number {
    return this.state;
  }

  clone(): SeededRandom {
    return new SeededRandom(this.state);
  }
}

export class MathRandomSource implements RandomSource {
  next(): number {
    return Math.random();
  }
}

export function randomInt(random: RandomSource, maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("maxExclusive must be a positive safe integer.");
  }
  const sample = random.next();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new Error("RandomSource.next() must return a value in [0, 1).");
  }
  return Math.floor(sample * maxExclusive);
}

export function shuffle<T>(values: readonly T[], random: RandomSource): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomInt(random, index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function chooseOne<T>(values: readonly T[], random: RandomSource): T | undefined {
  if (values.length === 0) return undefined;
  return values[randomInt(random, values.length)];
}
