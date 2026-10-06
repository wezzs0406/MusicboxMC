import type { PitchRegion } from './pitchMap';

/**
 * 「某个位置该放什么方块」的统一解析层。
 *
 * 刻意不针对某一种位置写特例：新增位置类型只需在 `BlockSlot` 里加一个名字，
 * 覆盖规则与解析优先级自动生效。红石线下方只是它的第一个使用者。
 *
 * 每个位置都可以解析成 `minecraft:air`（即"这里不放方块"），由调用方决定是否允许。
 */
export type BlockSlot =
  /** 红石线 / 中继器下方，防止它们悬空掉落 */
  | 'wireSupport'
  /** 音符盒下方，决定音色 */
  | 'noteBase'
  /** 通用地板 */
  | 'floor';

export type BlockTable = Record<BlockSlot, string>;

export const AIR = 'minecraft:air';

/** 全局默认值。 */
export const DEFAULT_BLOCK_TABLE: BlockTable = {
  wireSupport: 'minecraft:dirt',
  noteBase: 'minecraft:grass_block',
  floor: 'minecraft:dirt',
};

/**
 * 默认值分两级：全局 + 音区。
 *
 * 音区级默认是必要的 —— 音符盒垫底方块本来就按音区不同（A/B/C/D/E 五区音色不同），
 * 所以"默认值"本身就要能按 A/B/C/D/E 音区给。
 */
export interface BlockDefaults {
  global: BlockTable;
  regions?: Partial<Record<PitchRegion, Partial<BlockTable>>>;
}

/** 音轨级 / 音区级覆盖，值可以是任意方块 id（含 `minecraft:air`）。 */
export interface BlockOverrides {
  tracks?: Record<number, Partial<BlockTable>>;
  regions?: Partial<Record<PitchRegion, Partial<BlockTable>>>;
}

export interface BlockQuery {
  slot: BlockSlot;
  trackIndex?: number;
  region?: PitchRegion;
}

export type BlockResolver = (query: BlockQuery) => string;

/**
 * 解析优先级（由具体到宽泛）：
 *   覆盖·音区 > 覆盖·音轨 > 默认·音区 > 默认·全局
 *
 * 覆盖优先于默认；音区优先于音轨，因为音区直接决定音色（垫底方块换了乐器就变了）。
 */
export function createBlockResolver(
  defaults: BlockDefaults = { global: DEFAULT_BLOCK_TABLE },
  overrides: BlockOverrides = {},
): BlockResolver {
  return ({ slot, trackIndex, region }) => {
    if (region !== undefined) {
      const o = overrides.regions?.[region]?.[slot];
      if (o !== undefined) return o;
    }

    if (trackIndex !== undefined) {
      const o = overrides.tracks?.[trackIndex]?.[slot];
      if (o !== undefined) return o;
    }

    if (region !== undefined) {
      const d = defaults.regions?.[region]?.[slot];
      if (d !== undefined) return d;
    }

    return defaults.global[slot];
  };
}

export function isAir(block: string): boolean {
  return block === AIR;
}
