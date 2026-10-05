export type PitchRegion = 'A' | 'B' | 'C';
export type OutOfRangePolicy = 'warn' | 'clamp' | 'octave' | 'drop';

export interface RegionDef {
  /** 垫底方块 id（决定乐器/音色） */
  baseBlock: string;
  /** note = 0 时该音区发声对应的 MIDI 音高 */
  baseMidi: number;
}

export type RegionTable = Record<PitchRegion, RegionDef>;

export interface MappedPitch {
  /** 是否被丢弃（outOfRange = 'drop' 时可能为 true） */
  dropped: boolean;
  midi: number;
  /** 音符盒档位 0-24 */
  note: number;
  region: PitchRegion;
  /** 垫底方块 */
  block: string;
  /** 是否因超出音域被降级 */
  degraded: boolean;
}

/** 单个音区的半音跨度：note 0..24 共 25 档，跨 24 个半音。 */
export const REGION_SEMITONES = 24;

/** 三音区默认映射：B 区为原版竖琴（F#3 起），A 低两个八度，C 高两个八度。 */
export const DEFAULT_REGIONS: RegionTable = {
  A: { baseBlock: 'minecraft:dirt', baseMidi: 30 },
  B: { baseBlock: 'minecraft:grass_block', baseMidi: 54 },
  C: { baseBlock: 'minecraft:bedrock', baseMidi: 78 },
};

/** 覆盖的 MIDI 音高区间（含端点）。 */
export function coveredRange(regions: RegionTable): [number, number] {
  const lows = (Object.keys(regions) as PitchRegion[]).map((k) => regions[k].baseMidi);
  return [Math.min(...lows), Math.max(...lows) + REGION_SEMITONES];
}

/**
 * MIDI 音高 → (note 档位, 音区, 垫底方块)。
 * 优先 B 区（原版音色），端点 54 / 78 归 B。
 */
export function mapPitch(
  midi: number,
  regions: RegionTable = DEFAULT_REGIONS,
  policy: OutOfRangePolicy = 'warn',
  transpose = 0,
): MappedPitch {
  const p = midi + 12 * transpose;

  for (const region of ['B', 'A', 'C'] as PitchRegion[]) {
    const def = regions[region];
    const note = p - def.baseMidi;
    if (note >= 0 && note <= REGION_SEMITONES) {
      return { dropped: false, midi, note, region, block: def.baseBlock, degraded: false };
    }
  }

  return applyOutOfRange(p, midi, regions, policy);
}

function applyOutOfRange(
  p: number,
  midi: number,
  regions: RegionTable,
  policy: OutOfRangePolicy,
): MappedPitch {
  const [low, high] = coveredRange(regions);
  const pick = (pp: number): MappedPitch => {
    for (const region of ['B', 'A', 'C'] as PitchRegion[]) {
      const def = regions[region];
      const note = pp - def.baseMidi;
      if (note >= 0 && note <= REGION_SEMITONES) {
        return { dropped: false, midi, note, region, block: def.baseBlock, degraded: true };
      }
    }
    // 理论不可达
    return { dropped: true, midi, note: 0, region: 'B', block: regions.B.baseBlock, degraded: true };
  };

  if (policy === 'drop') {
    return { dropped: true, midi, note: 0, region: 'B', block: regions.B.baseBlock, degraded: true };
  }
  if (policy === 'clamp') {
    return pick(p < low ? low : high);
  }
  // 'warn' 与 'octave' 都按整数八度平移回可用音域，保留音级
  let shifted = p;
  const octaves = Math.ceil((low - p) / 12);
  shifted = p + 12 * octaves;
  if (shifted > high) shifted -= 12;
  return pick(shifted);
}
