import {
  buildTrack,
  chordCapacity,
  gameTickToRedstone,
  groupByTick,
  maxChordRows,
  naturalSamples,
  type TrackNote,
  type XPlan,
} from './track';
import type { LayoutConfig, LayoutResult, LayoutWarning, Vec3 } from './types';
import type { SongModel } from '../midi/types';
import { DEFAULT_REGIONS, type RegionTable } from '../palette/pitchMap';
import {
  createBlockResolver,
  DEFAULT_BLOCK_TABLE,
  type BlockDefaults,
  type BlockOverrides,
  type BlockResolver,
} from '../palette/blockTable';
import { secondsToTick } from '../tempo/tick';
import type { TrackModel } from '../midi/types';

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  axis: 'x',
  baseTps: 20,
  circuitY: 1,
  floorY: 0,
  dMax: 14,
  trackPitch: 'auto',
  leadInCells: 3,
  maxSegmentCells: 4096,
  bridgeTicks: 2,
  maxRegionSize: 32,
};

export interface LayoutOptions {
  config?: Partial<LayoutConfig>;
  regions?: RegionTable;
  /** 超出音域时的处理策略 */
  outOfRange?: 'warn' | 'clamp' | 'octave' | 'drop';
  /** 需要排除的轨（如打击乐轨） */
  excludeTracks?: number[];
  /** 每轨 transpose 覆盖 */
  transpose?: Record<number, number>;
  /** 方块选择覆盖（按音轨 / 音区），见 palette/blockTable */
  blocks?: BlockOverrides;
  /**
   * 同乐器并轨：乐器相同的 MIDI 轨合并成**一条主线**（打击乐单独归一类）。
   *
   * 合并后这些音本来就落在同一条线上，天然不存在跨轨 X 漂移，
   * 不必再靠补齐去逼近对齐；代价是同刻音会变成和弦（超容量时按既有规则拆轨）。
   * 默认 false —— 每轨一条线。合并后的 transpose / 方块覆盖沿用组内第一个原轨。
   */
  mergeSameInstrument?: boolean;
}

/** 归并键：打击乐单独一类，其余按乐器名。 */
function instrumentKey(t: TrackModel): string {
  return t.percussion ? 'percussion' : t.instrument;
}

function mergeByInstrument<T extends { index: number; notes: TrackNote[]; key: string }>(
  inputs: T[],
): T[] {
  const groups = new Map<string, T>();
  for (const input of inputs) {
    const hit = groups.get(input.key);
    if (hit) hit.notes.push(...input.notes);
    else groups.set(input.key, { ...input, notes: [...input.notes] });
  }
  return [...groups.values()];
}

/** 音符盒垫底方块本来就按音区不同，所以把它作为"音区级默认值"喂给解析层。 */
function regionDefaults(regions: RegionTable): BlockDefaults {
  return {
    global: DEFAULT_BLOCK_TABLE,
    regions: {
      A: { noteBase: regions.A.baseBlock },
      B: { noteBase: regions.B.baseBlock },
      C: { noteBase: regions.C.baseBlock },
      D: { noteBase: regions.D.baseBlock },
      E: { noteBase: regions.E.baseBlock },
    },
  };
}

/**
 * 建全曲共享的「曲中时刻 → X」参考线：取各轨自然排布 X 的**上包络**。
 *
 * 上包络必然 ≥ 任一轨的自然 X，于是每条轨只需往前补红石线（0 延迟）即可跟上，
 * 既不会出现"要后退/要压缩"的情况，也不需要改时值或跨轨接线。
 * 同一量化时刻的跨轨 X 差因此被限制在容差内，不会随曲长累积。
 */
function buildXPlan(samples: Array<{ atRt: number; x: number }>): XPlan {
  const sorted = [...samples].sort((a, b) => a.atRt - b.atRt);
  const envelope: Array<{ atRt: number; x: number }> = [];
  let max = 0;
  for (const s of sorted) {
    max = Math.max(max, s.x);
    const last = envelope[envelope.length - 1];
    if (last && last.atRt === s.atRt) last.x = max;
    else envelope.push({ atRt: s.atRt, x: max });
  }
  return {
    targetX(atRt: number): number {
      let lo = 0;
      let hi = envelope.length - 1;
      let hit = 0;
      // 最后一个 atRt ≤ 查询时刻的采样点
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (envelope[mid]!.atRt <= atRt) {
          hit = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return envelope.length === 0 ? 0 : envelope[hit]!.x;
    },
  };
}

/** 构造布局用的方块解析器（测试与 service 复用同一份默认值）。 */
export function layoutResolver(
  regions: RegionTable = DEFAULT_REGIONS,
  overrides: BlockOverrides = {},
): BlockResolver {
  return createBlockResolver(regionDefaults(regions), overrides);
}

/** 顶层入口：SongModel → 电路布局。 */
export function layout(song: SongModel, opts: LayoutOptions = {}): LayoutResult {
  const config: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG, ...opts.config };
  const regions = opts.regions ?? DEFAULT_REGIONS;
  const exclude = new Set(opts.excludeTracks ?? []);
  const resolve = layoutResolver(regions, opts.blocks ?? {});

  // 每轨音符数组只算一次（行数预扫、全局前导与主循环共用）。
  const inputs: Array<{ index: number; notes: TrackNote[]; key: string }> = [];
  for (const t of song.tracks) {
    if (exclude.has(t.index) || t.notes.length === 0) continue;
    const notes: TrackNote[] = t.notes.map((n) => ({
      tick: secondsToTick(n.timeSec, config.baseTps),
      midi: n.midi,
    }));
    inputs.push({ index: t.index, notes, key: instrumentKey(t) });
  }

  // 合轨会增加同刻音符数量，必须先合轨再计算轨距和首音前导。
  const trackInputs = opts.mergeSameInstrument ? mergeByInstrument(inputs) : inputs;
  const maxSideRows = Math.max(1, Math.min(14, Math.floor(config.dMax)));
  const maxChordNotes = chordCapacity(config.dMax);
  let maxRows = 0;
  let minRt = Number.POSITIVE_INFINITY;
  for (const { notes } of trackInputs) {
    maxRows = Math.max(maxRows, maxChordRows(notes, maxSideRows));
    for (const n of notes) minRt = Math.min(minRt, gameTickToRedstone(n.tick));
  }

  // 中继器最小 1 档 ⇒ rt 0 的音最早也要 1 红刻后才能发声。为保住
  // **跨轨相对时序**，该前导必须全曲统一：只要曲中存在 rt 0 的音组，
  // 所有轨一律 +1 红刻；只按单轨推断会让不同轨的首音偏移互相不一致。
  const base = minRt === 0 ? 1 : 0;

  // 多轨空间对齐：X 由曲中时刻决定，取各轨自然 X 的上包络作共享参考线。
  const samples: Array<{ atRt: number; x: number }> = [];
  for (const { notes } of trackInputs) {
    samples.push(...naturalSamples(notes, base, maxChordNotes));
  }
  const plan = buildXPlan(samples);

  const pitch = config.trackPitch === 'auto' ? 2 * maxRows + 2 : config.trackPitch;

  const warnings: LayoutWarning[] = [];
  const tracks = [];
  const placed: LayoutResult['placed'] = [];
  let maxTick = 0;
  let trackSlot = 0;

  for (const { index, notes } of trackInputs) {

    // 超出单列和弦容量的音群改派到新音轨（TRACK_SPLIT）：每条轨有独立的
    // 主线与分线列容量；各轨共用启动时刻，同 rt 的音在新轨按剩余音数
    // 重新铺线，触发时刻不变。
    let pending = notes;
    for (let lane = 0; pending.length > 0; lane++) {
      const zBase = maxRows + trackSlot * pitch;
      const { track, warnings: w, overflow, placed: pl } = buildTrack({
        trackIndex: index,
        zBase,
        notes: pending,
        config,
        regions,
        resolve,
        transpose: opts.transpose?.[index] ?? 0,
        outOfRange: opts.outOfRange,
        collectOverflow: true,
        base,
        plan,
      });

      warnings.push(...w);
      tracks.push(track);
      for (const p of pl) placed.push({ trackIndex: index, zBase, ...p });
      trackSlot++;

      if (overflow.length === 0) break;
      pending = overflow.flatMap((o) => o.notes);
      for (const o of overflow) {
        warnings.push({ code: 'TRACK_SPLIT', tick: o.tick, notes: o.notes.length });
      }
    }

    for (const g of groupByTick(notes)) maxTick = Math.max(maxTick, g.tick);
  }

  // 包围盒：取全量 min/max。region 原点依赖它做平移，算错会导致导出越界。
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = config.circuitY;
  let maxZ = 0;
  let hasBlock = false;
  for (const tr of tracks) {
    for (const p of [...tr.placements, ...tr.bridges]) {
      hasBlock = true;
      minX = Math.min(minX, p.pos.x);
      maxX = Math.max(maxX, p.pos.x);
      minY = Math.min(minY, p.pos.y);
      maxY = Math.max(maxY, p.pos.y);
      minZ = Math.min(minZ, p.pos.z);
      maxZ = Math.max(maxZ, p.pos.z);
    }
  }
  if (!hasBlock) {
    minX = 0;
    minY = 0;
    minZ = 0;
  }

  const size: Vec3 = { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 };
  const min: Vec3 = { x: minX, y: minY, z: minZ };

  return { tracks, size, min, totalTicks: maxTick, warnings, placed };
}
