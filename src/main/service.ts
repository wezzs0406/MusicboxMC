import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseMidi } from '../core/midi/parse';
import type { SongModel } from '../core/midi/types';
import { layout, DEFAULT_LAYOUT_CONFIG } from '../core/layout/index';
import { sliceRegions } from '../core/layout/regions';
import type { LayoutConfig, LayoutWarning } from '../core/layout/types';
import { DEFAULT_REGIONS } from '../core/palette/pitchMap';
import {
  buildLitematic,
  MC_1_20_4_DATA_VERSION,
  LITEMATIC_VERSION_1_20_4,
  type RegionData,
} from '../core/litematic/build';
import { formatDuration, speedTable, type SpeedRow } from '../core/tempo/speed';
import type { BlockOverrides } from '../core/palette/blockTable';
import { MAX_QUANTIZE_ERROR_MS, secondsToTick } from '../core/tempo/tick';

/** 渲染进程可提交的参数。只暴露 core 层已有能力，不引入新语义。 */
export interface GenerateOptions {
  baseTps?: number;
  dMax?: number;
  outOfRange?: 'warn' | 'clamp' | 'octave' | 'drop';
  excludeTracks?: number[];
  transpose?: Record<number, number>;
  /** 方块选择覆盖（按音轨 / 音区） */
  blocks?: BlockOverrides;
  /** 同乐器并轨：乐器相同的音轨合并成一条主线（打击乐单独一类） */
  mergeSameInstrument?: boolean;
  speedPresets?: number[];
  author?: string;
}

export interface TrackSummary {
  index: number;
  name: string;
  channel: number;
  instrument: string;
  percussion: boolean;
  noteCount: number;
  minTick: number;
  maxTick: number;
}

export interface RegionSummary {
  name: string;
  /** 该区域所属的原始音轨 index（供预览把 Z 行标回音轨；拆出的新轨与原轨同号） */
  trackIndex: number;
  position: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  blockCount: number;
}

/**
 * 俯视预览。
 *
 * 新几何下红石线、中继器、音符盒**都在同一层**（音符盒正上方必须留空），
 * 所以不能再按 Y 分层 —— 改为按方块类型分三层输出，
 * 前端按「地板 → 线 → 音符盒」叠画，既能看清排线又能看清音符落点。
 */
export interface PreviewData {
  size: { x: number; y: number; z: number };
  /** 预览网格左上角在整图坐标系中的 X/Z */
  origin: { x: number; z: number };
  /** 红石线 / 中继器 */
  wireCells: string[];
  /** 与 wireCells 同长度：中继器的档位（1–4），非中继器为 '' */
  repeaterDelays: string[];
  /** 音符盒 */
  noteCells: string[];
  /** 地板（垫底方块） */
  baseCells: string[];
  /** 出现过的方块 id 去重列表，供前端配色 */
  blocks: string[];
}

export interface SongSummary {
  name: string;
  ppq: number;
  durationSec: number;
  durationText: string;
  baseBpm: number;
  timeSignature: [number, number] | null;
  trackCount: number;
  noteCount: number;
  quantizeErrorMs: number;
}

export interface AnalyzeResult {
  path: string;
  file: string;
  song: SongSummary;
  tracks: TrackSummary[];
  tempoSegments: Array<{ ticks: number; timeSec: number; bpm: number }>;
}

export interface GenerateResult extends AnalyzeResult {
  success: boolean;
  /** 生成失败时的人类可读原因 */
  error?: string;
  /** 已落盘的投影路径（仅 generateToFile 会给） */
  outputPath?: string;
  /** 投影字节数 */
  bytes: number;
  /** 超出可用音域的音符数；> 0 时前端必须提示装资源包（F-12） */
  outOfRangeNotes: number;
  stats: {
    tickCount: number;
    noteBlockCount: number;
    circuitBlocks: number;
    regionCount: number;
    elapsedMs: number;
  };
  speedTable: SpeedRow[];
  warnings: LayoutWarning[];
  regions: RegionSummary[];
  preview: PreviewData;
}

const DEFAULT_PRESETS = [1.0, 0.75, 0.5, 1.5, 2.0];

const EMPTY_LAYER: string[] = [];

const EMPTY_PREVIEW: PreviewData = {
  size: { x: 0, y: 0, z: 0 },
  origin: { x: 0, z: 0 },
  wireCells: EMPTY_LAYER,
  repeaterDelays: EMPTY_LAYER,
  noteCells: EMPTY_LAYER,
  baseCells: EMPTY_LAYER,
  blocks: [],
};

function summarizeTracks(song: SongModel): TrackSummary[] {
  return song.tracks.map((t) => {
    const ticks = t.notes.map((n) => secondsToTick(n.timeSec));
    return {
      index: t.index,
      name: t.name,
      channel: t.channel,
      instrument: t.instrument,
      percussion: t.percussion,
      noteCount: t.notes.length,
      minTick: ticks.length > 0 ? Math.min(...ticks) : 0,
      maxTick: ticks.length > 0 ? Math.max(...ticks) : 0,
    };
  });
}

function analyze(song: SongModel, path: string): AnalyzeResult {
  return {
    path,
    file: basename(path),
    song: {
      name: song.name,
      ppq: song.ppq,
      durationSec: song.durationSec,
      durationText: formatDuration(song.durationSec),
      baseBpm: song.baseBpm,
      timeSignature: song.timeSignature,
      trackCount: song.tracks.length,
      noteCount: song.tracks.reduce((s, t) => s + t.notes.length, 0),
      quantizeErrorMs: MAX_QUANTIZE_ERROR_MS,
    },
    tracks: summarizeTracks(song),
    tempoSegments: song.tempos,
  };
}

function toRegionData(slices: ReturnType<typeof sliceRegions>): RegionData[] {
  return slices.map((s) => ({
    position: s.position,
    size: s.size,
    blocks: s.blocks.map((b) => ({
      x: b.pos.x,
      y: b.pos.y,
      z: b.pos.z,
      state: { name: b.block, properties: b.props ?? {} },
    })),
  }));
}

/** 预览按方块类型分层：线 / 音符盒 / 地板。 */
function buildPreview(slices: ReturnType<typeof sliceRegions>): PreviewData {
  if (slices.length === 0) {
    return {
      size: { x: 0, y: 0, z: 0 },
      origin: { x: 0, z: 0 },
      wireCells: EMPTY_LAYER,
      repeaterDelays: EMPTY_LAYER,
      noteCells: EMPTY_LAYER,
      baseCells: EMPTY_LAYER,
      blocks: [],
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let maxY = 0;
  for (const s of slices) {
    minX = Math.min(minX, s.position.x);
    minZ = Math.min(minZ, s.position.z);
    maxX = Math.max(maxX, s.position.x + s.size.x);
    maxZ = Math.max(maxZ, s.position.z + s.size.z);
    maxY = Math.max(maxY, s.position.y + s.size.y);
  }
  const width = maxX - minX;
  const depth = maxZ - minZ;

  // 行优先 index = z * width + x
  const wireCells = new Array<string>(width * depth).fill('');
  const repeaterDelays = new Array<string>(width * depth).fill('');
  const noteCells = new Array<string>(width * depth).fill('');
  const baseCells = new Array<string>(width * depth).fill('');

  for (const s of slices) {
    for (const b of s.blocks) {
      const gx = s.position.x + b.pos.x - minX;
      const gz = s.position.z + b.pos.z - minZ;
      const idx = gz * width + gx;
      if (idx < 0 || idx >= width * depth) continue;
      const layer =
        b.block === 'minecraft:redstone_wire' || b.block === 'minecraft:repeater'
          ? wireCells
          : b.block === 'minecraft:note_block'
            ? noteCells
            : baseCells;
      // 同格只可能有一个方块（布局保证不重叠），无需覆盖规则
      if (layer[idx] === '') layer[idx] = b.block;
      if (layer === wireCells && b.block === 'minecraft:repeater') {
        repeaterDelays[idx] = b.props?.delay ?? '';
      }
    }
  }

  const all = [...wireCells, ...noteCells, ...baseCells].filter((c) => c !== '');
  return {
    size: { x: width, y: maxY, z: depth },
    origin: { x: minX, z: minZ },
    wireCells,
    repeaterDelays,
    noteCells,
    baseCells,
    blocks: [...new Set(all)].sort(),
  };
}

/** 只解析，不生成电路。用于导入后立刻显示文件信息。 */
export function analyzeFile(path: string): AnalyzeResult {
  return analyze(parseMidi(readFileSync(path)), path);
}

function layoutOptions(options: GenerateOptions) {
  // 只把用户显式给出的项透传，其余交给 layout() 与默认值合并
  const config: Partial<LayoutConfig> = {};
  if (options.baseTps !== undefined) config.baseTps = options.baseTps;
  if (options.dMax !== undefined) config.dMax = options.dMax;

  return {
    config,
    regions: DEFAULT_REGIONS,
    outOfRange: options.outOfRange,
    excludeTracks: options.excludeTracks,
    transpose: options.transpose,
    blocks: options.blocks,
    mergeSameInstrument: options.mergeSameInstrument,
  };
}

interface FailureContext {
  base: AnalyzeResult;
  /** 曲目时长，用于算变速表 */
  durationSec: number;
  error: string;
  presets: number[];
  baseTps: number;
}

function failure(ctx: FailureContext): GenerateResult {
  return {
    ...ctx.base,
    success: false,
    error: ctx.error,
    bytes: 0,
    outOfRangeNotes: 0,
    stats: { tickCount: 0, noteBlockCount: 0, circuitBlocks: 0, regionCount: 0, elapsedMs: 0 },
    speedTable: speedTable(ctx.durationSec, ctx.presets, ctx.baseTps),
    warnings: [],
    regions: [],
    preview: EMPTY_PREVIEW,
  };
}

/**
 * 完整链路：解析 → 布局 → 切区域 → litematic 字节。
 * 失败不抛错，而是回 success=false + error，便于 GUI 直接展示。
 */
export function generate(
  path: string,
  options: GenerateOptions = {},
): { result: GenerateResult; buffer: Buffer | null } {
  const start = Date.now();
  const presets = options.speedPresets ?? DEFAULT_PRESETS;
  const baseTps = options.baseTps ?? DEFAULT_LAYOUT_CONFIG.baseTps;

  const song = parseMidi(readFileSync(path));
  const base = analyze(song, path);

  const included = song.tracks.filter(
    (t) => t.notes.length > 0 && !(options.excludeTracks ?? []).includes(t.index),
  );
  if (included.length === 0) {
    return {
      result: failure({
        base,
        durationSec: song.durationSec,
        error: '没有可生成的音轨（全部为空或被排除）',
        presets,
        baseTps,
      }),
      buffer: null,
    };
  }

  let result;
  try {
    result = layout(song, layoutOptions(options));
  } catch (e) {
    return {
      result: failure({
        base,
        durationSec: song.durationSec,
        error: `电路布局失败：${(e as Error).message}`,
        presets,
        baseTps,
      }),
      buffer: null,
    };
  }

  const slices = sliceRegions(result);
  if (slices.length === 0) {
    const f = failure({
      base,
      durationSec: song.durationSec,
      error: '没有可生成的音符（可能全部被音域策略丢弃）',
      presets,
      baseTps,
    });
    f.warnings = result.warnings;
    f.outOfRangeNotes = result.warnings.filter((w) => w.code === 'OUT_OF_RANGE').length;
    return { result: f, buffer: null };
  }
  let buffer: Buffer;
  try {
    buffer = buildLitematic(toRegionData(slices), {
      name: song.name || basename(path),
      author: options.author ?? 'MusicboxMC',
      description: `MusicboxMC — ${result.tracks.length} 轨 / ${result.totalTicks} ticks`,
      dataVersion: MC_1_20_4_DATA_VERSION,
      version: LITEMATIC_VERSION_1_20_4,
    });
  } catch (e) {
    const f = failure({
      base,
      durationSec: song.durationSec,
      error: `litematic 写入失败：${(e as Error).message}`,
      presets,
      baseTps,
    });
    f.warnings = result.warnings;
    return { result: f, buffer: null };
  }

  const outOfRangeNotes = result.warnings.filter((w) => w.code === 'OUT_OF_RANGE').length;
  const noteBlockCount = result.tracks.reduce(
    (s, t) => s + t.placements.filter((p) => p.block === 'minecraft:note_block').length,
    0,
  );

  return {
    result: {
      ...base,
      success: true,
      bytes: buffer.length,
      outOfRangeNotes,
      stats: {
        tickCount: result.totalTicks,
        noteBlockCount,
        circuitBlocks: result.tracks.reduce((s, t) => s + t.placements.length, 0),
        regionCount: slices.length,
        elapsedMs: Date.now() - start,
      },
      speedTable: speedTable(song.durationSec, presets, baseTps),
      warnings: result.warnings,
      regions: slices.map((s, i) => ({
        name: `region_${i}`,
        trackIndex: s.trackIndex,
        position: s.position,
        size: s.size,
        blockCount: s.blocks.length,
      })),
      preview: buildPreview(slices),
    },
    buffer,
  };
}

/** 生成并落盘。 */
export function generateToFile(
  path: string,
  outputPath: string,
  options: GenerateOptions = {},
): GenerateResult {
  const { result, buffer } = generate(path, options);
  if (!result.success || buffer === null) return result;
  writeFileSync(outputPath, buffer);
  return { ...result, outputPath };
}
