import type {
  BlockPlacement,
  DelayStep,
  LayoutConfig,
  LayoutWarning,
  PlacedNote,
  Segment,
  Tap,
  TrackSkeleton,
  Vec3,
} from './types';
import {
  mapPitch,
  type NoteBlockInstrument,
  type PitchRegion,
  type RegionTable,
} from '../palette/pitchMap';
import type { BlockResolver } from '../palette/blockTable';

/** 单个音符的时间/音高输入。tick 为游戏刻（默认 20/秒）。 */
export interface TrackNote {
  /** 已量化的触发 tick（游戏刻） */
  tick: number;
  midi: number;
}

export interface BuildTrackOptions {
  trackIndex: number;
  zBase: number;
  notes: TrackNote[];
  config: LayoutConfig;
  regions: RegionTable;
  resolve: BlockResolver;
  transpose?: number;
  outOfRange?: 'warn' | 'clamp' | 'octave' | 'drop';
  /**
   * 超出单列和弦容量的音符不丢弃，而是登记后供上层改派到新音轨。
   */
  collectOverflow?: boolean;
  /**
   * 全轨统一的红刻前导（0 或 1，由 layout() 按全曲计算后传入）。
   *
   * 中继器最小 1 档：落在 rt 0 的音最早也只能 1 红刻后发声。为保住
   * **跨轨相对时序**，该前导必须全曲统一——只要曲中存在 rt 0 的音组，
   * 所有轨一律 +1 红刻；只按单轨推断会让不同轨的首音偏移互相不一致。
   * 缺省时按本轨首组推断（供直接调用 buildTrack 的测试/脚本使用）。
   */
  base?: number;
  /**
   * 全曲共享的「曲中时刻 → X」参考线（多轨空间对齐用）。
   * 传入后本轨会按需补**红石线**跟上参考线；不传则按自然排布（单轨场景）。
   */
  plan?: XPlan;
}

/** 单个超出单列容量的音群，供上层改派到其他音轨。 */
export interface OverflowGroup {
  tick: number;
  notes: TrackNote[];
}

/**
 * 新拓扑（示例.txt）：主线自带中继器、音符盒内联在主线里。
 *
 *   主线: …[N][分线列 W][R(r)][N][分线列 W][R(r)][N]…（沿 +X）
 *   和弦: 分线列向 ±Z 各延伸若干行，每行 [W][R(r)][N]，与主线行同构。
 *
 * 时间模型：红石粉不按格计延迟，只有中继器计延迟（1–4 红石刻，
 * 1 红石刻 = 2 游戏刻 = 0.1s @20TPS）。相邻两组的间隔 = 组前中继器
 * 档位之和；组内齐响靠「分支行中继器档位 == 主线行末级中继器档位」。
 *
 * 主线接续：中继器充能音符盒，被充能的音符盒给后方红石线供电
 * （开发笔记 §4「只导一跳」），下一组的中继器从该线得电。
 * 该接法与相邻组的网隔离均待游戏内实测确认（重写任务 §8）。
 */

/** 1 红石刻 = 2 游戏刻 = 0.1 秒（20 TPS）。 */
export const GAME_TICKS_PER_REDSTONE_TICK = 2;

/** 中继器单档延迟上限（红石刻）。 */
export const MAX_REPEATER_DELAY = 4;

/** 红石线满信号强度。 */
export const WIRE_STRENGTH = 15;

/**
 * 分线列向单侧可延伸的最大行数。
 *
 * 列上距供电格 d 行的红石线功率 = 15 − d，分支中继器输入需要 ≥1，
 * 故 d ≤ 14。这是信号强度给出的物理上限，不是预设容量。
 */
export const MAX_SIDE_ROWS = WIRE_STRENGTH - 1;

/** 一个分线列可承载的最大和弦音数：1 内联 + 每侧 MAX_SIDE_ROWS 行。 */
export const MAX_CHORD_NOTES = 2 * MAX_SIDE_ROWS + 1;

/** 将用户配置转换为受红石强度上限约束的单列容量。 */
export function chordCapacity(dMax: number): number {
  if (!Number.isFinite(dMax)) return MAX_CHORD_NOTES;
  const rows = Math.max(1, Math.min(MAX_SIDE_ROWS, Math.floor(dMax)));
  return 2 * rows + 1;
}

/**
 * 实际触发与期望的最大偏差（游戏刻）。
 * 新拓扑下偏差只来自红石刻量化：|tick − 2·rt| ≤ 1。
 */
export const MAX_TRIGGER_SHIFT = 1;

/** 游戏刻 → 红石刻（四舍五入到 0.1s 网格）。 */
export function gameTickToRedstone(tick: number): number {
  return Math.round(tick / GAME_TICKS_PER_REDSTONE_TICK);
}

/**
 * 多轨空间对齐容差（格）。
 *
 * 各轨的 X 由**曲中时刻**决定（见 XPlan），偏差超过该值才用红石线补齐，
 * 因此同一段音乐的各轨始终保持在这段局部范围内，不会随曲长越走越散。
 * 10–15 是"检查间隔"量级，不是给任何曲目承诺的绝对最大误差。
 */
export const ALIGN_TOLERANCE_CELLS = 12;

/**
 * 历史兼容常量。
 *
 * 早期实现只在自然位置差不超过这个窗口时才强制共轴；现在同刻不同轨
 * 一律尝试共轴，距离仅影响是否会产生 SPATIAL_DRIFT 告警，因此该值不再
 * 作为同步判定门槛保留。
 */
export const SYNC_ALIGN_WINDOW_CELLS = 10;

/**
 * 单个补齐段（纯红石线）的最大格数。
 *
 * 信号强度 15，末端给中继器/音符盒供电需 ≥1，故留 1 格余量取 13。
 * 补齐**只用红石线**：线不产生延迟，所以补格不改变任何音的触发时刻。
 */
export const MAX_PAD_RUN = 13;

/**
 * 全曲共享的「曲中时刻 → X」参考线。
 *
 * 取各轨**自然排布**（不补格）的 X 上包络：包络必然 ≥ 任一轨的自然 X，
 * 于是每条轨只需往前补，永远不需要后退或被压缩，
 * 也因此不需要改动中继器时值、不需要跨轨接线。
 */
export interface XPlan {
  /** 给定曲中时刻（含全曲前导的红刻）返回参考 X（音符列位置） */
  targetX(atRt: number): number;
  /** 该时刻是否有多条独立音轨同时落音，需要尽量共用 X 轴 */
  isSynchronized(atRt: number): boolean;
}

/**
 * 一条音轨自然排布（不补格）时各音组的 X 采样，供 index.ts 建上包络。
 *
 * 与 buildTrack 的走线规则严格一致：组前中继器 ceil(rest/4) 格 + 分线列 1 格
 * + 末级中继器 1 格 + 音符列 1 格；首组且 rest>0 时另有一格起始线。
 */
export function naturalSamples(
  notes: TrackNote[],
  base: number,
  maxNotes: number = MAX_CHORD_NOTES,
): Array<{ atRt: number; x: number }> {
  const counts = new Map<number, number>();
  for (const n of notes) {
    const rt = gameTickToRedstone(n.tick);
    counts.set(rt, (counts.get(rt) ?? 0) + 1);
  }
  const rts = [...counts.keys()].sort((a, b) => a - b);
  const out: Array<{ atRt: number; x: number }> = [];
  let x = 0;
  let prevRt = 0;
  let first = true;
  for (const rt of rts) {
    const gap = rt + base - prevRt;
    const r = Math.min(MAX_REPEATER_DELAY, gap);
    const rest = gap - r;
    const restCells = Math.ceil(rest / MAX_REPEATER_DELAY);
    const n = Math.min(counts.get(rt)!, maxNotes);
    if (first && rest > 0) x = 1;
    x += restCells + groupTailCells(n);
    out.push({ atRt: rt + base, x: x - 1 }); // 音符列
    prevRt = rt + base;
    first = false;
  }
  return out;
}

/** 按 tick（游戏刻）归并音符。仅用于 totalTicks 统计；布局按红石刻分组。 */
export function groupByTick(notes: TrackNote[]): Array<{ tick: number; midi: number[] }> {
  const map = new Map<number, number[]>();
  for (const n of notes) {
    const arr = map.get(n.tick);
    if (arr) arr.push(n.midi);
    else map.set(n.tick, [n.midi]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, midi]) => ({ tick, midi }));
}

/** 和弦第 j 个分支音所在的行：+1, −1, +2, −2, …（两侧交替） */
export function branchRow(j: number): { side: 1 | -1; row: number } {
  return { side: j % 2 === 0 ? 1 : -1, row: Math.floor(j / 2) + 1 };
}

/** n 音和弦向单侧延伸的行数。 */
export function chordRows(n: number): number {
  return n <= 1 ? 0 : Math.ceil((n - 1) / 2);
}

/** 和弦中一个额外音所在的行（不含内联的主线行）。 */
export interface ChordRow {
  side: 1 | -1;
  row: number;
  /** true = 由内联音符盒**一跳传导**点亮：该行不放线、不放中继器 */
  conducted: boolean;
}

/**
 * 和弦各额外音的行布局。
 *
 * **≤3 个音 → 一跳传导（一个簇）**：只用一个中继器充能内联（中间）那个音符盒，
 * 相邻行的音符盒被它点亮，同刻发声 —— 不需要各自的线与中继器。
 * 上限是 3 的原因：音符盒只导一跳，一排 [a][b][c][d] 充能 b 时只有 a、c 响，d 不响。
 * 主线仍从**被充能的那个**（内联/中间）往 +X 接续。
 *
 * **≥4 个音 → 分支模式**：分线列必须连续铺线才能到达外圈，而簇会占住 ±1 行
 * （列被音符盒挡住），所以 4 个以上回到"每个额外音各占一行、各配一个中继器"。
 */
/**
 * 该组在「组前中继器之后」占几格：分线列 1 格 + 中继器 1 格 + 音符列 1 格 = 3，
 * 或（不需要分线列时）中继器 1 格 + 音符列 1 格 = 2。
 *
 * **只有 ≥4 音和弦才铺分线列**：外圈分支行要在同一刻取电，纵向供能只能用
 * 红石粉（中继器任何朝向都会加延迟）。除此之外末级中继器的输入直接取自
 * 背后的方块（上一个音符盒 / 上一个中继器），中间那格红石粉是多余的。
 */
export function groupTailCells(n: number): number {
  return chordRowLayout(n).some((r) => !r.conducted) ? 3 : 2;
}

export function chordRowLayout(n: number): ChordRow[] {
  if (n <= 1) return [];
  if (n === 2) return [{ side: 1, row: 1, conducted: true }];
  if (n === 3) {
    return [
      { side: -1, row: 1, conducted: true },
      { side: 1, row: 1, conducted: true },
    ];
  }
  return Array.from({ length: n - 1 }, (_, j) => ({ ...branchRow(j), conducted: false }));
}

/** 预扫描一条音轨的最大和弦行数（用于 zBase 内移与轨距规划）。 */
export function maxChordRows(notes: TrackNote[], maxSideRows: number = MAX_SIDE_ROWS): number {
  const counts = new Map<number, number>();
  for (const n of notes) {
    const rt = gameTickToRedstone(n.tick);
    counts.set(rt, (counts.get(rt) ?? 0) + 1);
  }
  let max = 0;
  for (const c of counts.values()) {
    max = Math.max(max, Math.min(chordRows(c), maxSideRows));
  }
  return max;
}

/** 一个待落位的音符（已映射到音符盒档位、音区与垫底方块）。 */
interface NoteToPlace {
  /** 源音符（overflow 改派时用） */
  source: TrackNote;
  midi: number;
  note: number;
  region: PitchRegion;
  block: string;
  instrument: NoteBlockInstrument;
  degraded: boolean;
}

/**
 * 构建单条音轨的主线 + 各和弦分支。
 *
 * 时间模型：组间隔 gap（红石刻）= 组前中继器档位之和（红石粉 0 延迟）；
 * 末级中继器取 min(4, gap)，其余档位放在更靠前的串联中继器上。
 * 组内第 0 个音内联主线，其余音沿分线列 ±Z 行展开，
 * 每行中继器档位与主线行末级相同 ⇒ 全组同红石刻触发。
 */
export function buildTrack(opts: BuildTrackOptions): {
  track: TrackSkeleton;
  warnings: LayoutWarning[];
  /** 仅当 collectOverflow = true 时可能有值 */
  overflow: OverflowGroup[];
  /** 每个已放置音群的期望 tick 与实际触发 tick（游戏刻；actual = 2·rt） */
  placed: Array<{ tick: number; actual: number }>;
} {
  const warnings: LayoutWarning[] = [];
  const overflow: OverflowGroup[] = [];
  const maxChordNotes = chordCapacity(opts.config.dMax);

  // 1) 音高映射 + 按红石刻分组
  interface Group {
    rt: number;
    /** 组内最小原始游戏刻（告警与 placed 报告用） */
    tick: number;
    notes: NoteToPlace[];
  }
  const groupMap = new Map<number, Group>();
  for (const n of opts.notes) {
    const m = mapPitch(n.midi, opts.regions, opts.outOfRange ?? 'warn', opts.transpose ?? 0);
    if (m.dropped) {
      warnings.push({ code: 'OUT_OF_RANGE', midi: n.midi, action: 'drop' });
      continue;
    }
    // 自动八度移调是用户明确选择的无提示策略；其余降级策略仍需在结果中说明。
    if (m.degraded && (opts.outOfRange ?? 'warn') !== 'octave') {
      warnings.push({ code: 'OUT_OF_RANGE', midi: n.midi, action: opts.outOfRange ?? 'warn' });
    }
    const rt = gameTickToRedstone(n.tick);
    let g = groupMap.get(rt);
    if (!g) {
      g = { rt, tick: n.tick, notes: [] };
      groupMap.set(rt, g);
    }
    g.tick = Math.min(g.tick, n.tick);
    g.notes.push({
      source: n,
      midi: n.midi,
      note: m.note,
      region: m.region,
      block: m.block,
      instrument: m.instrument,
      degraded: m.degraded,
    });
  }
  const groups = [...groupMap.values()].sort((a, b) => a.rt - b.rt);

  // 2) 和弦容量：超出单列物理上限（信号强度）的部分移入 overflow
  const prepared: Group[] = [];
  for (const g of groups) {
    if (g.notes.length <= maxChordNotes) {
      prepared.push(g);
      continue;
    }
    warnings.push({
      code: 'POLYPHONY_EXCEEDED',
      tick: g.tick,
      n: g.notes.length,
      limit: maxChordNotes,
    });
    const sorted = [...g.notes].sort((a, b) => b.midi - a.midi);
    prepared.push({ rt: g.rt, tick: g.tick, notes: sorted.slice(0, maxChordNotes) });
    const rest = sorted.slice(maxChordNotes);
    if (opts.collectOverflow && rest.length > 0) {
      overflow.push({ tick: g.tick, notes: rest.map((n) => n.source) });
    }
  }

  // 3) 沿 +X 铺主线：[组前中继器][分线列][中继器列][音符列]
  const placements: BlockPlacement[] = [];
  /** 主线行（z = zBase）的非音符格序列（旧 Segment.steps 约定：线/中继器，不含音符盒） */
  const mainSteps: DelayStep[] = [];
  const taps: Tap[] = [];
  const placed: Array<{ tick: number; actual: number }> = [];

  const asDelay = (n: number): 1 | 2 | 3 | 4 => n as 1 | 2 | 3 | 4;

  const putWire = (x: number, z: number, isMain: boolean): void => {
    // 投影是**未通电的初始状态**：红石粉一律 power=0，等玩家在起点接电后
    // 由游戏自行传播。写 15 会把整条线预点亮（粘贴即满强度，与实际不符）。
    placements.push({
      pos: { x, y: opts.config.circuitY, z },
      block: 'minecraft:redstone_wire',
      props: { power: '0' },
    });
    placements.push({
      pos: { x, y: opts.config.floorY, z },
      block: opts.resolve({ slot: 'wireSupport', trackIndex: opts.trackIndex }),
    });
    if (isMain) mainSteps.push({ kind: 'wire', ticks: 1 });
  };

  const putRelay = (x: number, z: number, delay: number, isMain: boolean): void => {
    // 输出必须朝 +X（音符盒侧）。注意 blockstate 语义：facing 是"从输出侧指向
    // 输入侧"的向量，与箭头方向相反 —— 输出朝东 ⇒ facing=west（输入在西侧线列）。
    placements.push({
      pos: { x, y: opts.config.circuitY, z },
      block: 'minecraft:repeater',
      props: { facing: 'west', delay: String(delay), locked: 'false', powered: 'false' },
    });
    placements.push({
      pos: { x, y: opts.config.floorY, z },
      block: opts.resolve({ slot: 'wireSupport', trackIndex: opts.trackIndex }),
    });
    if (isMain) mainSteps.push({ kind: 'repeater', ticks: asDelay(delay) });
  };

  const putNote = (x: number, z: number, n: NoteToPlace, path: Vec3[]): PlacedNote => {
    const notePos: Vec3 = { x, y: opts.config.circuitY, z };
    placements.push({
      pos: notePos,
      block: 'minecraft:note_block',
      props: {
        instrument: n.instrument,
        note: String(n.note),
        powered: 'false',
      },
    });
    placements.push({
      pos: { x, y: opts.config.floorY, z },
      block: opts.resolve({ slot: 'noteBase', trackIndex: opts.trackIndex, region: n.region }),
    });
    return {
      notePos,
      blockPos: { x, y: opts.config.floorY, z },
      note: n.note,
      block: n.block,
      path,
    };
  };

  let x = 0;
  let prevRt = 0;
  let first = true;
  let tapId = 0;

  // 首组落在 rt 0 时，电路至少需要 1 红石刻驱动（中继器最小档位），
  // 整轨统一加 1 红刻前导：各音相对时序不变，仅整体晚 0.1s 触发。
  // base 由 layout() 全曲统一计算传入；缺省时按本轨首组推断。
  const base = opts.base ?? (prepared.length > 0 && prepared[0]!.rt === 0 ? 1 : 0);
  if (base === 1) {
    warnings.push({
      code: 'TIMING_ADJUSTED',
      tick: prepared[0]!.tick,
      actual: GAME_TICKS_PER_REDSTONE_TICK,
    });
  }

  for (const g of prepared) {
    const gap = g.rt + base - prevRt; // ≥1（同 rt 已合并；base 保证首组 ≥1）
    const r = Math.min(MAX_REPEATER_DELAY, gap);
    const rest = gap - r;
    const restCells = Math.ceil(rest / MAX_REPEATER_DELAY);

    // 空间对齐：本组音符列的自然 X，与共享参考线比较。
    // 只在偏差超过容差时补齐，且**只用红石线**（0 延迟）——不改中继器时值、
    // 不跨轨接线、不靠补齐末端。同步点的容差为 0，尽量让同刻音符共用 X；
    // 若补线容量仍不足，则保留 SPATIAL_DRIFT 告警并报告无法消除的残差。
    // 只有 ≥4 音和弦才铺分线列（给外圈分支行供能），否则末级中继器直接接背后方块
    const tail = groupTailCells(g.notes.length);
    const noteXNatural = x + (first && rest > 0 ? 1 : 0) + restCells + (tail - 1);
    const atRt = g.rt + base;
    const targetX = opts.plan ? opts.plan.targetX(atRt) : noteXNatural;
    const deficit = Math.max(0, targetX - noteXNatural);
    const tolerance =
      opts.plan?.isSynchronized(atRt) === true ? 0 : ALIGN_TOLERANCE_CELLS;
    const padNeeded = Math.max(0, deficit - tolerance);
    const slots = restCells + 1; // 槽 0 在组前中继器之前，其后每个中继器之后各一槽
    const pad = Math.min(padNeeded, slots * MAX_PAD_RUN);
    if (padNeeded > pad) {
      warnings.push({ code: 'SPATIAL_DRIFT', tick: g.tick, drift: deficit - pad });
    }
    const padSlots = new Array<number>(slots).fill(0);
    if (pad > 0) {
      const each = Math.floor(pad / slots);
      for (let i = 0; i < slots; i++) padSlots[i] = each;
      for (let i = 0; i < pad % slots; i++) padSlots[i] = padSlots[i]! + 1;
    }

    // 首组且组前有中继器时，先铺一格起始线作为电源接入点
    // （rest = 0 时分线列本身就是首格，电源直接接在列上，保证列上功率为 15）
    if (first && rest > 0) {
      putWire(0, opts.zBase, true);
      x = 1;
    }

    // 补齐段（纯红石线，0 延迟）
    const putPad = (slot: number): void => {
      for (let i = 0; i < padSlots[slot]!; i++) {
        putWire(x, opts.zBase, true);
        x += 1;
      }
    };
    putPad(0);

    // 组前延迟中继器（同向首尾相接，档位之和 = rest）
    let remaining = rest;
    let slot = 1;
    while (remaining > 0) {
      const d = Math.min(MAX_REPEATER_DELAY, remaining);
      putRelay(x, opts.zBase, d, true);
      x += 1;
      remaining -= d;
      putPad(slot);
      slot += 1;
    }

    // 分线列：主线行 + 各分支行（同一列红石线互连为一网，同时得电）
    const xCol = x;
    const branches = chordRowLayout(g.notes.length);
    const needColumn = tail === 3;
    if (needColumn) putWire(xCol, opts.zBase, true);
    // 分支行（≥4 音）铺线做纵向供能；传导行不铺线（靠内联音符盒点亮）
    for (const b of branches) {
      if (!b.conducted) putWire(xCol, opts.zBase + b.side * b.row, false);
    }

    // 中继器列：全部朝东；主线行与分支行同为 r 档 ⇒ 组内同红石刻触发
    const xRelay = needColumn ? xCol + 1 : xCol;
    putRelay(xRelay, opts.zBase, r, true);
    for (const b of branches) {
      if (!b.conducted) putRelay(xCol + 1, opts.zBase + b.side * b.row, r, false);
    }

    // 音符列：第 0 个音内联主线（被中继器充能，主线从它往 +X 接续）；
    // 传导行没有红石路径，由内联音符盒一跳点亮，与主线上同刻发声。
    const xNote = xRelay + 1;
    const placedNotes: PlacedNote[] = [];
    placedNotes.push(
      // 无分线列时输入直接来自背后的方块（上一个音符盒 / 上一个中继器），路径为空
      putNote(xNote, opts.zBase, g.notes[0]!, needColumn ? [{ x: xCol, y: opts.config.circuitY, z: opts.zBase }] : []),
    );
    g.notes.slice(1).forEach((n, j) => {
      const b = branches[j]!;
      const z = opts.zBase + b.side * b.row;
      const path = b.conducted
        ? []
        : [
            { x: xCol, y: opts.config.circuitY, z },
            { x: xCol + 1, y: opts.config.circuitY, z },
          ];
      placedNotes.push(putNote(xNote, z, n, path));
    });

    taps.push({ id: tapId++, x: xCol, t: g.rt, d: chordRows(g.notes.length), notes: placedNotes });

    const actual = (g.rt + base) * GAME_TICKS_PER_REDSTONE_TICK;
    placed.push({ tick: g.tick, actual });
    // 量化偏移已含整轨前导 2·base；只有超出「前导 + 1 游刻网格误差」才逐组告警
    if (Math.abs(actual - g.tick - 2 * base) > MAX_TRIGGER_SHIFT) {
      warnings.push({ code: 'TIMING_ADJUSTED', tick: g.tick, actual });
    }

    x = xCol + tail;
    prevRt = g.rt + base;
    first = false;
  }

  const segment: Segment = {
    startTick: 0,
    endTick: prevRt,
    startX: 0,
    endX: x,
    dir: 1,
    yRow: opts.config.circuitY,
    steps: mainSteps,
    taps,
  };

  finalizeWireConnections(placements);

  return {
    track: {
      trackIndex: opts.trackIndex,
      zBase: opts.zBase,
      segments: [segment],
      placements,
      bridges: [],
    },
    warnings,
    overflow,
    placed,
  };
}

/**
 * 红石线的连接方向属于方块状态的一部分，不能只写 power。
 *
 * 手工放置红石粉时，Minecraft 会自动更新 north/east/south/west；
 * litematic 直接写入不会经过这个更新，因此省略这些属性会让红石粉
 * 加载后退化为四面无连接的小点，尤其会破坏四音以上和弦的分线列。
 */
function finalizeWireConnections(placements: BlockPlacement[]): void {
  const key = (pos: Vec3): string => `${pos.x},${pos.y},${pos.z}`;
  const byPos = new Map<string, BlockPlacement>();
  for (const placement of placements) byPos.set(key(placement.pos), placement);

  const directions = [
    { name: 'north', dx: 0, dz: -1 },
    { name: 'east', dx: 1, dz: 0 },
    { name: 'south', dx: 0, dz: 1 },
    { name: 'west', dx: -1, dz: 0 },
  ] as const;

  for (const wire of placements) {
    if (wire.block !== 'minecraft:redstone_wire') continue;
    const props: Record<string, string> = {
      ...(wire.props ?? {}),
      power: wire.props?.power ?? '0',
    };
    for (const direction of directions) {
      const neighbor = byPos.get(
        key({
          x: wire.pos.x + direction.dx,
          y: wire.pos.y,
          z: wire.pos.z + direction.dz,
        }),
      );
      props[direction.name] = wireConnection(neighbor);
    }
    wire.props = props;
  }
}

function wireConnection(neighbor: BlockPlacement | undefined): 'none' | 'side' {
  if (!neighbor) return 'none';
  if (
    neighbor.block === 'minecraft:redstone_wire' ||
    neighbor.block === 'minecraft:repeater' ||
    neighbor.block === 'minecraft:note_block'
  ) {
    return 'side';
  }
  return 'none';
}
