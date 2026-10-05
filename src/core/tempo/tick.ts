/** 默认 TPS：1 tick = 50ms（文档 §4.1）。 */
export const BASE_TPS = 20;

/** 每 tick 的毫秒数。 */
export const MS_PER_TICK = 1000 / BASE_TPS;

/** 量化误差上限（毫秒）：±(MS_PER_TICK / 2)。 */
export const MAX_QUANTIZE_ERROR_MS = MS_PER_TICK / 2;

/** 秒 → tick，四舍五入到 tick 网格。 */
export function secondsToTick(seconds: number, tps: number = BASE_TPS): number {
  return Math.round(seconds * tps);
}

/** tick → 秒。 */
export function tickToSeconds(tick: number, tps: number = BASE_TPS): number {
  return tick / tps;
}

/** 量化误差（毫秒），用于 GUI 提示，恒 ≤ 25ms。 */
export function quantizeErrorMs(seconds: number, tps: number = BASE_TPS): number {
  const tick = secondsToTick(seconds, tps);
  return Math.abs(tickToSeconds(tick, tps) - seconds) * 1000;
}
