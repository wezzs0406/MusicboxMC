export type PitchRegion = 'A' | 'B' | 'C' | 'D' | 'E';
export type OutOfRangePolicy = 'warn' | 'clamp' | 'octave' | 'drop';

export interface RegionDef {
  /** 垫底方块 id（决定乐器/音色） */
  baseBlock: string;
  /** note = 0 时该音区发声对应的 MIDI 音高 */
  baseMidi: number;
  /** 要写入音符盒 blockstate 的乐器事件。 */
  instrument: NoteBlockInstrument;
}

export type RegionTable = Record<PitchRegion, RegionDef>;

/**
 * Minecraft Java 音符盒的乐器事件。
 *
 * 这些事件的音高范围各自不同；本项目使用 bass / guitar / harp /
 * flute / bell 五个槽位拼出 F#1–F#7。
 */
export type NoteBlockInstrument = 'bass' | 'guitar' | 'harp' | 'flute' | 'bell';

export interface MappedPitch {
  /** 是否被丢弃（outOfRange = 'drop' 时可能为 true） */
  dropped: boolean;
  midi: number;
  /** 音符盒档位 0-24 */
  note: number;
  region: PitchRegion;
  /** 垫底方块 */
  block: string;
  /** 音符盒 blockstate 中的 instrument 值。 */
  instrument: NoteBlockInstrument;
  /** 是否因超出音域被降级 */
  degraded: boolean;
}

/** 单个音区的半音跨度：note 0..24 共 25 档，跨 24 个半音。 */
export const REGION_SEMITONES = 24;

/**
 * 五个采样槽位按原版音符盒的 F# 锚点排列：
 * - A：木板 → bass，F#1 起（MIDI 30）
 * - B：羊毛 → guitar，F#2 起（MIDI 42）
 * - C：普通方块 → harp/piano，F#3 起（MIDI 54）
 * - D：黏土 → flute，F#4 起（MIDI 66）
 * - E：金块 → bell，F#5 起（MIDI 78）
 *
 * 这个排列正好对应资源包里的 harp1..harp5。原先的 dirt /
 * grass_block / bedrock 会把低音和高音错误地落到 harp 或 basedrum，
 * 既没有用到 guitar/flute，也无法得到连续的钢琴音色。
 */
export const DEFAULT_REGIONS: RegionTable = {
  A: { baseBlock: 'minecraft:oak_planks', baseMidi: 30, instrument: 'bass' },
  B: { baseBlock: 'minecraft:white_wool', baseMidi: 42, instrument: 'guitar' },
  C: { baseBlock: 'minecraft:dirt', baseMidi: 54, instrument: 'harp' },
  D: { baseBlock: 'minecraft:clay', baseMidi: 66, instrument: 'flute' },
  E: { baseBlock: 'minecraft:gold_block', baseMidi: 78, instrument: 'bell' },
};

/** 从低到高作为并列时的稳定顺序；实际选择按采样中心的距离决定。 */
const REGION_PRIORITY: PitchRegion[] = ['A', 'B', 'C', 'D', 'E'];

/** 覆盖的 MIDI 音高区间（含端点）。 */
export function coveredRange(regions: RegionTable): [number, number] {
  const lows = (Object.keys(regions) as PitchRegion[]).map((k) => regions[k].baseMidi);
  return [Math.min(...lows), Math.max(...lows) + REGION_SEMITONES];
}

/**
 * MIDI 音高 → (note 档位, 音区, 垫底方块)。
 *
 * 每个采样的 note=12 是它的原始录音音高（F#2..F#6）。在多个音区
 * 重叠时选择距离 note=12 最近的音区，尽量减少资源包的变速失真；
 * 同距离时选择较高音区，保证边界稳定地向上衔接。
 */
export function mapPitch(
  midi: number,
  regions: RegionTable = DEFAULT_REGIONS,
  policy: OutOfRangePolicy = 'warn',
  transpose = 0,
): MappedPitch {
  const p = midi + 12 * transpose;

  const selected = selectRegion(p, regions);
  if (selected) {
    const def = regions[selected.region];
    return {
      dropped: false,
      midi,
      note: selected.note,
      region: selected.region,
      block: def.baseBlock,
      instrument: def.instrument,
      degraded: false,
    };
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
    const selected = selectRegion(pp, regions);
    if (selected) {
      const def = regions[selected.region];
      return {
        dropped: false,
        midi,
        note: selected.note,
        region: selected.region,
        block: def.baseBlock,
        instrument: def.instrument,
        degraded: true,
      };
    }
    // 理论不可达
    return {
      dropped: true,
      midi,
      note: 0,
      region: 'C',
      block: regions.C.baseBlock,
      instrument: regions.C.instrument,
      degraded: true,
    };
  };

  if (policy === 'drop') {
    return {
      dropped: true,
      midi,
      note: 0,
      region: 'C',
      block: regions.C.baseBlock,
      instrument: regions.C.instrument,
      degraded: true,
    };
  }
  if (policy === 'clamp') {
    return pick(p < low ? low : high);
  }
  // 'warn' 与 'octave' 都按整数八度平移回可用音域，区别只在上层是否提示用户
  let shifted = p;
  const octaves = Math.ceil((low - p) / 12);
  shifted = p + 12 * octaves;
  if (shifted > high) shifted -= 12;
  return pick(shifted);
}

function selectRegion(
  midi: number,
  regions: RegionTable,
): { region: PitchRegion; note: number } | null {
  let best: { region: PitchRegion; note: number; distance: number } | null = null;
  for (const region of REGION_PRIORITY) {
    const def = regions[region];
    const note = midi - def.baseMidi;
    if (note < 0 || note > REGION_SEMITONES) continue;
    const distance = Math.abs(note - 12);
    if (
      best === null ||
      distance < best.distance ||
      (distance === best.distance && def.baseMidi > regions[best.region].baseMidi)
    ) {
      best = { region, note, distance };
    }
  }
  return best ? { region: best.region, note: best.note } : null;
}
