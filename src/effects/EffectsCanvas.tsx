import { useEffect, useRef } from "react";
import { RANK_LABELS, type Card, type Suit } from "../game";
import { useI18n } from "../i18n";

export interface AttackVisual {
  id: string;
  source: "player" | "enemy";
  cards: Card[];
  damage: number;
  startedAt: number;
  blocked?: boolean;
}

interface EffectsCanvasProps {
  attacks: readonly AttackVisual[];
  now: number;
}

interface Point {
  x: number;
  y: number;
}

type ImpactSide = "enemy" | "player";

interface ImpactAnchor {
  xRatio: number;
  yRatio: number;
  heightRatio: number;
}

interface CanvasMetrics {
  width: number;
  height: number;
}

type ImpactAnchorCache = Partial<Record<ImpactSide, ImpactAnchor>>;

const HIT_STAGGER_MS = 112;
const FLIGHT_DURATION_MS = 255;
const IMPACT_DURATION_MS = 320;
const REDUCED_FINAL_DURATION_MS = 260;

const warmStarFills = ["#ffd629", "#ff7f9c", "#ffffff"] as const;
const warmStarStrokes = ["#e88700", "#d93c69", "#ff6f91"] as const;
const coolStarFills = ["#ffd629", "#83efff", "#ffffff"] as const;
const coolStarStrokes = ["#e88700", "#1687cf", "#38bfe4"] as const;

const suitSymbols: Record<Suit, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

const redSuits = new Set<Suit>(["hearts", "diamonds"]);

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function easeOutBack(value: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

function easeInCubic(value: number) {
  return value * value * value;
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function stringSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed: number, index: number) {
  const value = Math.sin((seed + index * 1013) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function flightPoint(
  progress: number,
  startX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  arcHeight: number,
  source: AttackVisual["source"],
): Point {
  const travel = easeInCubic(clamp01(progress));
  const arc = Math.sin(clamp01(progress) * Math.PI) * arcHeight;
  return {
    x: startX + (targetX - startX) * travel,
    y: sourceY + (targetY - sourceY) * travel - (source === "player" ? arc : -arc),
  };
}

export function EffectsCanvas({ attacks, now }: EffectsCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const impactAnchorsRef = useRef<ImpactAnchorCache>({});
  const canvasMetricsRef = useRef<CanvasMetrics>({ width: 0, height: 0 });
  const refreshImpactAnchorsRef = useRef<() => void>(() => undefined);
  const observedAttackIdsRef = useRef(new Set<string>());
  const { t } = useI18n();
  const damageLabel = t("impact.damage");
  const blockLabel = t("impact.block");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scope = canvas.closest(".battle-stage") ?? document;
    const anchorElements: Partial<Record<ImpactSide, Element>> = {};

    for (const side of ["enemy", "player"] as const) {
      const segment = scope.querySelector(`[data-testid="${side}-hp-bar"]`);
      const anchor = segment?.querySelector(".pd-hp-duel__track") ?? segment;
      if (anchor) anchorElements[side] = anchor;
    }

    const refreshImpactAnchors = () => {
      const canvasBounds = canvas.getBoundingClientRect();
      if (canvasBounds.width <= 0 || canvasBounds.height <= 0) return;
      canvasMetricsRef.current = { width: canvasBounds.width, height: canvasBounds.height };
      const next: ImpactAnchorCache = {};

      for (const side of ["enemy", "player"] as const) {
        const element = anchorElements[side];
        if (!element) continue;
        const bounds = element.getBoundingClientRect();
        next[side] = {
          xRatio: clamp01((bounds.left + bounds.width / 2 - canvasBounds.left) / canvasBounds.width),
          yRatio: clamp01((bounds.top + bounds.height / 2 - canvasBounds.top) / canvasBounds.height),
          heightRatio: Math.max(0, bounds.height / canvasBounds.height),
        };
      }
      impactAnchorsRef.current = next;
    };

    refreshImpactAnchorsRef.current = refreshImpactAnchors;
    refreshImpactAnchors();

    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(refreshImpactAnchors);
    observer?.observe(canvas);
    for (const element of Object.values(anchorElements)) {
      if (element) observer?.observe(element);
    }
    window.addEventListener("resize", refreshImpactAnchors, { passive: true });
    document.addEventListener("fullscreenchange", refreshImpactAnchors);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", refreshImpactAnchors);
      document.removeEventListener("fullscreenchange", refreshImpactAnchors);
      refreshImpactAnchorsRef.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let foundNewAttack = false;
    for (const attack of attacks) {
      if (observedAttackIdsRef.current.has(attack.id)) continue;
      observedAttackIdsRef.current.add(attack.id);
      foundNewAttack = true;
    }
    if (foundNewAttack) refreshImpactAnchorsRef.current();
    if (observedAttackIdsRef.current.size > 128) {
      observedAttackIdsRef.current.clear();
      for (const attack of attacks) observedAttackIdsRef.current.add(attack.id);
    }

    if (canvasMetricsRef.current.width <= 0 || canvasMetricsRef.current.height <= 0) {
      refreshImpactAnchorsRef.current();
    }
    const bounds = canvasMetricsRef.current;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(320, Math.round(bounds.width * ratio));
    const height = Math.max(480, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.save();
    context.scale(ratio, ratio);
    const viewWidth = width / ratio;
    const viewHeight = height / ratio;
    const shortSide = Math.min(viewWidth, viewHeight);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    for (const attack of attacks) {
      const elapsed = now - attack.startedAt;
      const sourceY = attack.source === "player" ? viewHeight * 0.84 : viewHeight * 0.2;
      const targetSide: ImpactSide = attack.source === "player" ? "enemy" : "player";
      const targetAnchor = impactAnchorsRef.current[targetSide];
      const targetY = targetAnchor ? targetAnchor.yRatio * viewHeight : viewHeight * 0.5;
      const targetX = targetAnchor
        ? targetAnchor.xRatio * viewWidth
        : attack.source === "player" ? viewWidth * 0.34 : viewWidth * 0.66;
      const targetHeight = targetAnchor ? targetAnchor.heightRatio * viewHeight : 0;
      const compact = viewWidth <= 720 || (targetHeight > 0 && targetHeight < 24);
      const cardSpacing = Math.min(68, viewWidth * 0.055);
      const sourceCenter = viewWidth * 0.5;
      const arcHeight = Math.min(96, viewHeight * 0.09);
      const seed = stringSeed(attack.id);

      attack.cards.forEach((card, index) => {
        const localTime = elapsed - index * HIT_STAGGER_MS;
        const startX = sourceCenter + (index - (attack.cards.length - 1) / 2) * cardSpacing;
        if (localTime < 0 || localTime > FLIGHT_DURATION_MS + IMPACT_DURATION_MS) return;
        const isFinalHit = index === attack.cards.length - 1;

        if (reducedMotion) {
          const reducedImpactAge = localTime - FLIGHT_DURATION_MS;
          if (reducedImpactAge < 0 || reducedImpactAge >= IMPACT_DURATION_MS) return;
          const reducedProgress = clamp01(reducedImpactAge / IMPACT_DURATION_MS);
          if (attack.blocked) {
            drawReducedBlockImpact(context, targetX, targetY, reducedProgress, shortSide, compact);
          } else {
            drawReducedStarImpact(
              context,
              targetX,
              targetY,
              index,
              reducedProgress,
              seed,
              attack.source,
              isFinalHit,
              compact,
            );
          }
          return;
        }

        const progress = clamp01(localTime / FLIGHT_DURATION_MS);
        const position = flightPoint(
          progress,
          startX,
          sourceY,
          targetX,
          targetY,
          arcHeight,
          attack.source,
        );
        const scale = 0.7 + progress * 0.25;

        if (progress < 1) {
          drawFlightTrail(
            context,
            card,
            progress,
            startX,
            sourceY,
            targetX,
            targetY,
            arcHeight,
            attack.source,
            scale,
          );
          drawSpeedLines(
            context,
            position,
            flightPoint(
              Math.max(0, progress - 0.055),
              startX,
              sourceY,
              targetX,
              targetY,
              arcHeight,
              attack.source,
            ),
            seed + index * 41,
            progress,
            attack.source,
          );
          context.save();
          context.translate(position.x, position.y);
          context.rotate((attack.source === "player" ? -1 : 1) * (1 - progress) * 0.24);
          context.scale(scale, scale);
          drawCard(context, card);
          context.restore();
        } else {
          const impactProgress = clamp01((localTime - FLIGHT_DURATION_MS) / IMPACT_DURATION_MS);
          if (attack.blocked) {
            drawBlockImpact(context, targetX, targetY, impactProgress, index, seed, shortSide);
          } else {
            drawImpact(
              context,
              targetX,
              targetY,
              index,
              impactProgress,
              seed,
              attack.source,
              shortSide,
              isFinalHit,
              compact,
            );
          }
        }
      });

      const finalImpactAt = (attack.cards.length - 1) * HIT_STAGGER_MS + FLIGHT_DURATION_MS;
      const finalAge = elapsed - finalImpactAt;
      if (reducedMotion && finalAge >= 0 && finalAge < REDUCED_FINAL_DURATION_MS) {
        drawReducedFinalResult(
          context,
          targetX,
          targetY,
          finalAge / REDUCED_FINAL_DURATION_MS,
          attack.damage,
          attack.source,
          attack.blocked ? blockLabel : damageLabel,
          Boolean(attack.blocked),
          compact,
        );
      } else if (!reducedMotion && finalAge >= 0 && finalAge < 545) {
        if (attack.blocked) {
          drawFinalBlock(context, targetX, targetY, finalAge, viewWidth, viewHeight, seed, blockLabel);
        } else {
          drawFinalDamage(
            context,
            attack.damage,
            attack.source,
            targetX,
            targetY,
            finalAge,
            viewWidth,
            viewHeight,
            seed,
            damageLabel,
          );
        }
      }
    }
    context.restore();
  }, [attacks, now, blockLabel, damageLabel]);

  return <canvas ref={canvasRef} className="effects-canvas" aria-hidden="true" />;
}

function drawCard(context: CanvasRenderingContext2D, card: Card) {
  const width = 58;
  const height = 80;
  context.shadowColor = "rgba(26, 20, 55, 0.3)";
  context.shadowBlur = 12;
  context.shadowOffsetY = 6;
  context.fillStyle = "#fffdf8";
  context.strokeStyle = "#ffd52e";
  context.lineWidth = 4;
  context.beginPath();
  context.roundRect(-width / 2, -height / 2, width, height, 10);
  context.fill();
  context.stroke();
  context.shadowColor = "transparent";
  context.fillStyle = redSuits.has(card.suit) ? "#df1730" : "#111629";
  context.textAlign = "center";
  context.font = '900 22px "Arial Rounded MT Bold", sans-serif';
  context.fillText(RANK_LABELS[card.rank], 0, -8);
  context.font = '900 26px "Arial Rounded MT Bold", sans-serif';
  context.fillText(suitSymbols[card.suit], 0, 22);
}

function drawFlightTrail(
  context: CanvasRenderingContext2D,
  card: Card,
  progress: number,
  startX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  arcHeight: number,
  source: AttackVisual["source"],
  scale: number,
) {
  for (let trail = 4; trail >= 1; trail -= 1) {
    const trailProgress = Math.max(0, progress - trail * 0.045);
    if (trailProgress === 0 && progress > 0.22) continue;
    const point = flightPoint(
      trailProgress,
      startX,
      sourceY,
      targetX,
      targetY,
      arcHeight,
      source,
    );
    context.save();
    context.translate(point.x, point.y);
    context.rotate((source === "player" ? -1 : 1) * (1 - trailProgress) * 0.24);
    context.scale(scale * (1 - trail * 0.025), scale * (1 - trail * 0.025));
    context.globalAlpha = (0.16 - trail * 0.025) * Math.min(1, progress * 5);
    drawCard(context, card);
    context.restore();
  }
}

function drawSpeedLines(
  context: CanvasRenderingContext2D,
  current: Point,
  previous: Point,
  seed: number,
  progress: number,
  source: AttackVisual["source"],
) {
  const deltaX = current.x - previous.x;
  const deltaY = current.y - previous.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length < 0.5 || progress < 0.08) return;
  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  const intensity = Math.sin(clamp01(progress) * Math.PI);
  context.save();
  context.lineCap = "round";
  context.globalCompositeOperation = "screen";
  for (let index = 0; index < 7; index += 1) {
    const offset = (seededUnit(seed, index) - 0.5) * 76;
    const lineLength = (24 + seededUnit(seed, index + 10) * 54) * intensity;
    const gap = 24 + seededUnit(seed, index + 20) * 24;
    const x = current.x + perpendicularX * offset - unitX * gap;
    const y = current.y + perpendicularY * offset - unitY * gap;
    const gradient = context.createLinearGradient(x, y, x - unitX * lineLength, y - unitY * lineLength);
    gradient.addColorStop(0, source === "player" ? "rgba(255,219,38,0.92)" : "rgba(111,232,255,0.92)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.strokeStyle = gradient;
    context.lineWidth = 1.5 + seededUnit(seed, index + 30) * 3;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - unitX * lineLength, y - unitY * lineLength);
    context.stroke();
  }
  context.restore();
}

function drawImpact(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  index: number,
  progress: number,
  seed: number,
  source: AttackVisual["source"],
  shortSide: number,
  isFinalHit: boolean,
  compact: boolean,
) {
  if (progress <= 0 || progress >= 1) return;
  const fade = Math.pow(1 - progress, 1.4);
  const impactSize = Math.min(128, shortSide * 0.22);
  const warm = source === "player";

  context.save();
  context.translate(x, y);
  context.globalCompositeOperation = "screen";

  for (let ring = 0; ring < 3; ring += 1) {
    const ringProgress = clamp01(progress * 1.25 - ring * 0.1);
    if (ringProgress <= 0) continue;
    context.globalAlpha = (1 - ringProgress) * (0.84 - ring * 0.18);
    context.strokeStyle = ring % 2 === 0 ? "#ffffff" : warm ? "#ffb31a" : "#67e8ff";
    context.lineWidth = Math.max(2, 10 - ringProgress * 7 - ring * 2);
    context.beginPath();
    context.arc(0, 0, 16 + ringProgress * impactSize * (0.8 + ring * 0.19), 0, Math.PI * 2);
    context.stroke();
  }

  context.globalAlpha = fade;
  context.rotate(index * 0.41 + progress * 0.28);
  context.fillStyle = warm ? "#ff355d" : "#287cff";
  context.strokeStyle = "#ffffff";
  context.lineWidth = 6;
  drawBurstPath(context, 22 + easeOutCubic(progress) * impactSize * 0.68, 13);
  context.fill();
  context.stroke();

  const sparkCount = isFinalHit ? 10 : 8;
  for (let spark = 0; spark < sparkCount; spark += 1) {
    const angle = seededUnit(seed + index * 101, spark) * Math.PI * 2;
    const distance = 28 + easeOutCubic(progress) * (35 + seededUnit(seed, spark + 31) * impactSize);
    const sparkLength = 7 + seededUnit(seed, spark + 61) * 18;
    const sparkX = Math.cos(angle) * distance;
    const sparkY = Math.sin(angle) * distance;
    context.globalAlpha = fade * (0.55 + seededUnit(seed, spark + 91) * 0.45);
    context.strokeStyle = spark % 3 === 0 ? "#ffffff" : warm ? "#ffd629" : "#8ff5ff";
    context.lineWidth = 2 + seededUnit(seed, spark + 121) * 3;
    context.beginPath();
    context.moveTo(sparkX, sparkY);
    context.lineTo(
      sparkX + Math.cos(angle) * sparkLength,
      sparkY + Math.sin(angle) * sparkLength,
    );
    context.stroke();
  }

  context.globalCompositeOperation = "source-over";
  const starCount = isFinalHit ? 8 : 4;
  const starFills = warm ? warmStarFills : coolStarFills;
  const starStrokes = warm ? warmStarStrokes : coolStarStrokes;
  const baseRadius = compact ? 4 : 7;
  const radiusRange = compact ? 4 : 6;
  const spread = compact ? 34 : 46;
  const spreadRange = compact ? 24 : 34;
  const pop = progress < 0.26 ? easeOutBack(progress / 0.26) : 1;
  const shrink = 1 - clamp01((progress - 0.68) / 0.32);
  for (let star = 0; star < starCount; star += 1) {
    const angle = seededUnit(seed + index * 13, star + 151) * Math.PI * 2;
    const distance = 6 + easeOutCubic(progress) * (
      spread + seededUnit(seed, star + 181) * spreadRange + (isFinalHit ? (compact ? 5 : 9) : 0)
    );
    const colorIndex = star % starFills.length;
    const radius = (baseRadius + seededUnit(seed, star + 211) * radiusRange) * (isFinalHit ? 1.2 : 1);
    context.save();
    context.translate(
      Math.cos(angle) * distance,
      Math.sin(angle) * distance - progress * (compact ? 4 : 8),
    );
    context.rotate(angle + (star % 2 === 0 ? 1 : -1) * progress * 3.4);
    context.scale(Math.max(0, pop * shrink), Math.max(0, pop * shrink));
    context.globalAlpha = fade;
    context.fillStyle = starFills[colorIndex];
    context.strokeStyle = starStrokes[colorIndex];
    context.lineWidth = compact ? 1.5 : 2;
    context.lineJoin = "round";
    drawStarPath(context, radius, 0.44);
    context.fill();
    context.stroke();
    context.restore();
  }
  context.restore();
}

function drawReducedStarImpact(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  index: number,
  progress: number,
  seed: number,
  source: AttackVisual["source"],
  isFinalHit: boolean,
  compact: boolean,
) {
  if (progress < 0 || progress >= 1) return;
  const warm = source === "player";
  const starFills = warm ? warmStarFills : coolStarFills;
  const starStrokes = warm ? warmStarStrokes : coolStarStrokes;
  const starCount = isFinalHit ? 8 : 4;
  const radius = compact ? 5 : 8;
  const distance = compact ? 18 : 28;
  const fade = 1 - progress;

  context.save();
  context.translate(x, y);
  for (let star = 0; star < starCount; star += 1) {
    const angle = seededUnit(seed + index * 13, star + 151) * Math.PI * 2;
    const colorIndex = star % starFills.length;
    context.save();
    context.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
    context.globalAlpha = fade;
    context.fillStyle = starFills[colorIndex];
    context.strokeStyle = starStrokes[colorIndex];
    context.lineWidth = compact ? 1.25 : 1.75;
    context.lineJoin = "round";
    drawStarPath(context, radius * (isFinalHit ? 1.15 : 1), 0.44);
    context.fill();
    context.stroke();
    context.restore();
  }
  context.restore();
}

function drawReducedBlockImpact(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
  shortSide: number,
  compact: boolean,
) {
  if (progress < 0 || progress >= 1) return;
  const size = Math.min(compact ? 42 : 64, shortSide * 0.12);
  context.save();
  context.translate(x, y);
  context.globalAlpha = 1 - progress;
  context.fillStyle = "rgba(45,132,255,0.78)";
  context.strokeStyle = "#8ff7ff";
  context.lineWidth = compact ? 3 : 5;
  drawShieldPath(context, size);
  context.fill();
  context.stroke();
  context.restore();
}

function drawReducedFinalResult(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
  damage: number,
  source: AttackVisual["source"],
  label: string,
  blocked: boolean,
  compact: boolean,
) {
  if (progress < 0 || progress >= 1) return;
  const fade = 1 - progress;
  const fontSize = compact ? 24 : 38;
  context.save();
  context.translate(x, y - (compact ? 28 : 42));
  context.globalAlpha = fade;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.font = `1000 ${fontSize}px "Arial Rounded MT Bold", sans-serif`;
  context.lineWidth = compact ? 5 : 7;
  context.strokeStyle = "#ffffff";
  const text = blocked ? label : `-${damage}`;
  context.strokeText(text, 0, 0);
  context.fillStyle = blocked ? "#342396" : source === "player" ? "#ed1744" : "#0872f9";
  context.fillText(text, 0, 0);
  context.restore();
}

function drawBlockImpact(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
  index: number,
  seed: number,
  shortSide: number,
) {
  if (progress <= 0 || progress >= 1) return;
  const fade = Math.pow(1 - progress, 1.25);
  const size = Math.min(118, shortSide * 0.21);
  context.save();
  context.translate(x, y);
  context.globalCompositeOperation = "screen";

  for (let ring = 0; ring < 4; ring += 1) {
    const ripple = clamp01(progress * 1.25 - ring * 0.09);
    if (ripple <= 0) continue;
    context.globalAlpha = (1 - ripple) * (0.9 - ring * 0.15);
    context.strokeStyle = ring % 2 === 0 ? "#7cf5ff" : "#9b6cff";
    context.lineWidth = Math.max(2, 11 - ripple * 8 - ring);
    context.beginPath();
    context.ellipse(0, 0, 24 + ripple * size, 19 + ripple * size * 0.78, index * 0.16, 0, Math.PI * 2);
    context.stroke();
  }

  const shieldScale = 0.72 + Math.sin(progress * Math.PI) * 0.36;
  context.scale(shieldScale, shieldScale);
  context.globalAlpha = fade;
  const shieldGradient = context.createLinearGradient(-55, -64, 62, 70);
  shieldGradient.addColorStop(0, "rgba(86,245,255,0.94)");
  shieldGradient.addColorStop(0.48, "rgba(40,117,255,0.9)");
  shieldGradient.addColorStop(1, "rgba(151,64,255,0.92)");
  context.fillStyle = shieldGradient;
  context.strokeStyle = "#ffffff";
  context.lineWidth = 6;
  drawShieldPath(context, size * 0.62);
  context.fill();
  context.stroke();

  for (let spark = 0; spark < 12; spark += 1) {
    const angle = seededUnit(seed + index * 79, spark) * Math.PI * 2;
    const distance = 48 + easeOutCubic(progress) * (32 + seededUnit(seed, spark + 20) * 54);
    context.globalAlpha = fade;
    context.fillStyle = spark % 2 === 0 ? "#ffffff" : "#7cf5ff";
    context.beginPath();
    context.arc(Math.cos(angle) * distance, Math.sin(angle) * distance, 2.5 + seededUnit(seed, spark + 40) * 4, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawFinalDamage(
  context: CanvasRenderingContext2D,
  damage: number,
  source: AttackVisual["source"],
  targetX: number,
  targetY: number,
  age: number,
  viewWidth: number,
  viewHeight: number,
  seed: number,
  label: string,
) {
  const appear = clamp01(age / 115);
  const fade = clamp01(1 - Math.max(0, age - 355) / 190);
  const pulse = easeOutBack(appear);
  const warm = source === "player";
  const centerX = viewWidth * 0.5;
  const centerY = Math.max(viewHeight * 0.36, Math.min(viewHeight * 0.57, targetY));
  const burstSize = Math.min(viewWidth * 0.42, viewHeight * 0.26, 230);

  context.save();
  const flash = context.createRadialGradient(targetX, targetY, 0, targetX, targetY, Math.max(viewWidth, viewHeight) * 0.58);
  flash.addColorStop(0, warm ? `rgba(255,63,91,${0.2 * fade})` : `rgba(34,133,255,${0.2 * fade})`);
  flash.addColorStop(0.45, warm ? `rgba(255,208,30,${0.09 * fade})` : `rgba(87,235,255,${0.09 * fade})`);
  flash.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = flash;
  context.fillRect(0, 0, viewWidth, viewHeight);

  context.translate(centerX, centerY);
  context.globalCompositeOperation = "screen";
  context.globalAlpha = fade * 0.72;
  context.rotate((seededUnit(seed, 400) - 0.5) * 0.16);
  context.fillStyle = warm ? "#ff3d63" : "#2188ff";
  context.strokeStyle = "#ffd629";
  context.lineWidth = 8;
  drawBurstPath(context, burstSize * (0.62 + pulse * 0.38), 18);
  context.fill();
  context.stroke();

  for (let ray = 0; ray < 16; ray += 1) {
    const angle = (ray / 16) * Math.PI * 2 + seededUnit(seed, ray + 430) * 0.14;
    const inner = burstSize * 0.72;
    const outer = burstSize * (1.04 + seededUnit(seed, ray + 460) * 0.32) * easeOutCubic(appear);
    context.globalAlpha = fade * 0.72;
    context.strokeStyle = ray % 2 === 0 ? "#ffffff" : warm ? "#ffd629" : "#83f3ff";
    context.lineWidth = ray % 3 === 0 ? 5 : 2.5;
    context.beginPath();
    context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
    context.stroke();
  }

  context.globalCompositeOperation = "source-over";
  context.rotate((seededUnit(seed, 400) - 0.5) * -0.16);
  context.scale(0.65 + pulse * 0.35, 0.65 + pulse * 0.35);
  context.globalAlpha = fade;
  const numberSize = Math.max(46, Math.min(82, viewWidth * 0.16));
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.font = `1000 ${numberSize}px "Arial Rounded MT Bold", sans-serif`;
  context.lineWidth = Math.max(8, numberSize * 0.15);
  context.strokeStyle = "#ffffff";
  context.strokeText(`-${damage}`, 0, -numberSize * 0.08);
  context.fillStyle = warm ? "#ed1744" : "#0872f9";
  context.fillText(`-${damage}`, 0, -numberSize * 0.08);
  context.font = `1000 ${Math.max(18, numberSize * 0.31)}px "Arial Rounded MT Bold", sans-serif`;
  context.lineWidth = 6;
  context.strokeText(label, 0, numberSize * 0.58);
  context.fillStyle = "#271b52";
  context.fillText(label, 0, numberSize * 0.58);
  context.restore();
}

function drawFinalBlock(
  context: CanvasRenderingContext2D,
  targetX: number,
  targetY: number,
  age: number,
  viewWidth: number,
  viewHeight: number,
  seed: number,
  label: string,
) {
  const appear = clamp01(age / 105);
  const fade = clamp01(1 - Math.max(0, age - 360) / 185);
  const pulse = easeOutBack(appear);
  const centerX = viewWidth * 0.5;
  const centerY = Math.max(viewHeight * 0.36, Math.min(viewHeight * 0.57, targetY));
  const shieldSize = Math.min(viewWidth * 0.24, viewHeight * 0.18, 142);

  context.save();
  const flash = context.createRadialGradient(targetX, targetY, 0, targetX, targetY, Math.max(viewWidth, viewHeight) * 0.55);
  flash.addColorStop(0, `rgba(90,226,255,${0.24 * fade})`);
  flash.addColorStop(0.42, `rgba(117,75,255,${0.12 * fade})`);
  flash.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = flash;
  context.fillRect(0, 0, viewWidth, viewHeight);

  context.translate(centerX, centerY);
  context.globalCompositeOperation = "screen";
  for (let ring = 0; ring < 4; ring += 1) {
    const ringProgress = clamp01(appear - ring * 0.09);
    if (ringProgress <= 0) continue;
    context.globalAlpha = fade * (0.82 - ring * 0.13) * (1 - ringProgress * 0.35);
    context.strokeStyle = ring % 2 === 0 ? "#79f3ff" : "#a370ff";
    context.lineWidth = Math.max(3, 12 - ring * 2);
    context.beginPath();
    context.ellipse(0, 0, shieldSize * (0.75 + ringProgress * (0.95 + ring * 0.2)), shieldSize * (0.54 + ringProgress * (0.68 + ring * 0.13)), 0, 0, Math.PI * 2);
    context.stroke();
  }

  context.globalCompositeOperation = "source-over";
  context.scale(0.62 + pulse * 0.38, 0.62 + pulse * 0.38);
  context.globalAlpha = fade;
  const shieldGradient = context.createLinearGradient(-shieldSize, -shieldSize, shieldSize, shieldSize);
  shieldGradient.addColorStop(0, "#73f5ff");
  shieldGradient.addColorStop(0.46, "#197dff");
  shieldGradient.addColorStop(1, "#a34dff");
  context.fillStyle = shieldGradient;
  context.strokeStyle = "#ffffff";
  context.lineWidth = 9;
  drawShieldPath(context, shieldSize);
  context.fill();
  context.stroke();

  for (let spark = 0; spark < 14; spark += 1) {
    const angle = seededUnit(seed, spark + 520) * Math.PI * 2;
    const distance = shieldSize * (0.92 + seededUnit(seed, spark + 550) * 0.45) * easeOutCubic(appear);
    context.globalAlpha = fade;
    context.fillStyle = spark % 2 === 0 ? "#ffffff" : "#7cf5ff";
    context.beginPath();
    context.arc(Math.cos(angle) * distance, Math.sin(angle) * distance, 3 + seededUnit(seed, spark + 580) * 5, 0, Math.PI * 2);
    context.fill();
  }

  const labelSize = Math.max(34, Math.min(66, viewWidth * 0.13));
  context.font = `1000 ${labelSize}px "Arial Rounded MT Bold", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = Math.max(8, labelSize * 0.16);
  context.strokeStyle = "#ffffff";
  context.strokeText(label, 0, shieldSize * 0.2);
  context.fillStyle = "#271b88";
  context.fillText(label, 0, shieldSize * 0.2);
  context.restore();
}

function drawBurstPath(context: CanvasRenderingContext2D, radius: number, points: number) {
  context.beginPath();
  for (let point = 0; point < points * 2; point += 1) {
    const pointRadius = point % 2 === 0 ? radius : radius * 0.46;
    const angle = (point * Math.PI) / points;
    const pointX = Math.cos(angle) * pointRadius;
    const pointY = Math.sin(angle) * pointRadius;
    if (point === 0) context.moveTo(pointX, pointY);
    else context.lineTo(pointX, pointY);
  }
  context.closePath();
}

function drawStarPath(context: CanvasRenderingContext2D, radius: number, innerRatio: number) {
  context.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const pointRadius = point % 2 === 0 ? radius : radius * innerRatio;
    const angle = -Math.PI / 2 + (point * Math.PI) / 5;
    const pointX = Math.cos(angle) * pointRadius;
    const pointY = Math.sin(angle) * pointRadius;
    if (point === 0) context.moveTo(pointX, pointY);
    else context.lineTo(pointX, pointY);
  }
  context.closePath();
}

function drawShieldPath(context: CanvasRenderingContext2D, size: number) {
  context.beginPath();
  context.moveTo(0, -size * 0.72);
  context.bezierCurveTo(size * 0.28, -size * 0.62, size * 0.52, -size * 0.55, size * 0.68, -size * 0.42);
  context.lineTo(size * 0.57, size * 0.18);
  context.bezierCurveTo(size * 0.49, size * 0.55, size * 0.2, size * 0.76, 0, size * 0.88);
  context.bezierCurveTo(-size * 0.2, size * 0.76, -size * 0.49, size * 0.55, -size * 0.57, size * 0.18);
  context.lineTo(-size * 0.68, -size * 0.42);
  context.bezierCurveTo(-size * 0.52, -size * 0.55, -size * 0.28, -size * 0.62, 0, -size * 0.72);
  context.closePath();
}
