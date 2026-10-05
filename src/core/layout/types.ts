export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type DelayStep =
  | { kind: 'wire'; ticks: 1 }
  | { kind: 'repeater'; ticks: 1 | 2 | 3 | 4; forced?: boolean };

export interface PlacedNote {
  /** 音符盒坐标 */
  notePos: Vec3;
  /** 垫底方块坐标 */
  blockPos: Vec3;
  /** 音符盒档位 0-24 */
  note: number;
  /** 垫底方块 id */
  block: string;
  /** 从分叉点到该音符盒的路径格（不含起点，含终点） */
  path: Vec3[];
}

export interface Tap {
  id: number;
  /** 骨架分叉点的 X */
  x: number;
  /** 骨架到达该分叉点的 tick */
  t: number;
  /** 支线补的 tick 数（= 该组曼哈顿半径 d） */
  d: number;
  notes: PlacedNote[];
}

export interface Segment {
  startTick: number;
  endTick: number;
  startX: number;
  endX: number;
  /** 行进方向，+1 = +X */
  dir: 1 | -1;
  /** 该段所在 Y 层（蛇形分段交替 2 / 3） */
  yRow: number;
  steps: DelayStep[];
  taps: Tap[];
}

export interface BlockPlacement {
  pos: Vec3;
  /** 方块 id */
  block: string;
  props?: Record<string, string>;
}

export interface TrackSkeleton {
  trackIndex: number;
  zBase: number;
  segments: Segment[];
  placements: BlockPlacement[];
  /** 段间跨接器方块 */
  bridges: BlockPlacement[];
}

export type LayoutWarning =
  | { code: 'POLYPHONY_EXCEEDED'; tick: number; n: number; limit: number }
  | { code: 'OUT_OF_RANGE'; midi: number; action: string }
  | { code: 'SEGMENT_HARD_CUT'; tick: number }
  | { code: 'LEAD_IN_USED'; tick: number }
  | { code: 'TIMING_ADJUSTED'; tick: number; actual: number }
  /** 密集音群放不下，已改派到新音轨 */
  | { code: 'TRACK_SPLIT'; tick: number; notes: number }
  /** 该处无法用红石线补齐跟上共享 X 参考线：报告时间与格数偏差，不改时值、不丢音 */
  | { code: 'SPATIAL_DRIFT'; tick: number; drift: number };

export interface LayoutResult {
  tracks: TrackSkeleton[];
  size: Vec3;
  /** 全图最小 x/y/z（用于把坐标平移到 litematic 的局部坐标系） */
  min: Vec3;
  totalTicks: number;
  warnings: LayoutWarning[];
  /** 每个已放置音群的期望 tick 与实际触发 tick（按音轨顺序） */
  placed: Array<{ trackIndex: number; zBase: number; tick: number; actual: number }>;
}

export interface LayoutConfig {
  axis: 'x';
  baseTps: number;
  /**
   * 电路层：红石线、中继器、音符盒都在这一层。
   *
   * 之所以只有一层，是因为音符盒**正上方必须是空气**才发声，
   * 所以红石线不能压在音符盒上方，只能与它同层相邻。
   */
  circuitY: number;
  /** 地板层，在电路层正下方，防止红石线悬空掉落 */
  floorY: number;
  /** 分线列单侧最多延伸多少行；总和弦容量为 2*dMax + 1 */
  dMax: number;
  trackPitch: number | 'auto';
  leadInCells: number;
  maxSegmentCells: number;
  bridgeTicks: number;
  maxRegionSize: number;
}
