import type { BlockPlacement, Vec3 } from '../layout/types';

/**
 * 纯逻辑红石模拟器，用于在无游戏环境下验证电路触发时刻与"能不能发声"。
 *
 * 采用"逐 tick + 传播前沿"模型：
 *  - 信号在导线中以 1 格 / tick 传播（曼哈顿距离 = tick 数），带强度衰减（15 起始，每格 -1）。
 *  - 中继器：输入上升沿后，等待 delay tick，再以强度 15 从 facing 方向输出。
 *  - 音符盒：**同层相邻**的供能（红石线有电 / 中继器输出指向它）触发一次。
 *
 * 两条实测确认的硬约束（本项目曾在这两处翻过车）：
 *  1. **音符盒正上方必须是空气**（或生物头颅）才发声 —— 红石线压在它上方就哑了。
 *  2. 音符盒靠**同层相邻**供电，不是"从上往下压"。
 *
 * 已知简化：不模拟方块更新顺序、区块边界、比较器/火把，
 * 也不模拟"被直接充能的音符盒给相邻音符盒充能"（当前布局用中继器，不依赖它）。
 */

export type Facing = 'north' | 'south' | 'east' | 'west';

interface WireCell {
  kind: 'wire';
  /** 本 tick 的有效强度（由传播前沿计算） */
  power: number;
}
interface RepeaterCell {
  kind: 'repeater';
  delay: number;
  facing: Facing;
  /** 输入当前是否为正 */
  inputOn: boolean;
  /** 计划输出的 tick（null = 未计划） */
  fireAt: number | null;
  /** 本 tick 是否正在输出 */
  outputting: boolean;
}
interface NoteCell {
  kind: 'note_block';
  note: number;
}
interface AirCell {
  kind: 'air';
}

type Cell = WireCell | RepeaterCell | NoteCell | AirCell | { kind: 'solid' };

const key = (p: Vec3): string => `${p.x},${p.y},${p.z}`;

const HORIZONTAL: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

const FACING_DELTA: Record<Facing, Vec3> = {
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  south: { x: 0, y: 0, z: 1 },
  north: { x: 0, y: 0, z: -1 },
};

export interface TriggerEvent {
  tick: number;
  pos: Vec3;
  note: number;
}

/** 音符盒正上方允许的方块：空气或生物头颅。 */
function allowsSound(above: Cell): boolean {
  return above.kind === 'air';
}

export class RedstoneSim {
  private grid = new Map<string, Cell>();

  constructor(placements: BlockPlacement[]) {
    for (const p of placements) {
      const props = p.props ?? {};
      if (p.block === 'minecraft:redstone_wire') {
        this.grid.set(key(p.pos), { kind: 'wire', power: 0 });
      } else if (p.block === 'minecraft:repeater') {
        this.grid.set(key(p.pos), {
          kind: 'repeater',
          delay: Number(props.delay ?? '1'),
          facing: (props.facing as Facing) ?? 'east',
          inputOn: false,
          fireAt: null,
          outputting: false,
        });
      } else if (p.block === 'minecraft:note_block') {
        this.grid.set(key(p.pos), { kind: 'note_block', note: Number(props.note ?? '0') });
      } else if (p.block !== 'minecraft:air') {
        this.grid.set(key(p.pos), { kind: 'solid' });
      }
    }
  }

  private cellAt(p: Vec3): Cell {
    return this.grid.get(key(p)) ?? { kind: 'air' };
  }

  /**
   * 逐 tick 推进模拟。
   * seeds 为外部持续电源位置（其导线强度恒为 15，模拟拉杆/按钮打火）。
   */
  run(seeds: Vec3[], tMax: number): TriggerEvent[] {
    const events: TriggerEvent[] = [];
    const seedKeys = new Set(seeds.map(key));

    const wirePower = new Map<string, number>();
    const prevPowered = new Map<string, boolean>();

    for (const [k, c] of this.grid) {
      if (c.kind === 'wire') wirePower.set(k, 0);
    }

    for (let tick = 0; tick <= tMax; tick++) {
      // ---- 1) 导线传播：以"上一 tick 的强度"为源，向邻居衰减 1 ----
      //       seed 处恒为满强度 15；中继器输出格在本 tick 稍后覆盖为满强度。
      //       强度 ≥1 的导线都会向邻居送 1（强度 1 传给邻居即 0，故邻居无电）。
      const nextPower = new Map<string, number>();
      for (const [k] of wirePower) {
        let best = seedKeys.has(k) ? 15 : 0;
        const here = parseKey(k);
        for (const d of HORIZONTAL) {
          const nk = key({ x: here.x + d.x, y: here.y + d.y, z: here.z + d.z });
          const np = wirePower.get(nk);
          if (np !== undefined && np > 0) best = Math.max(best, np - 1);
        }
        nextPower.set(k, best);
      }
      for (const [k, v] of nextPower) wirePower.set(k, v);

      // ---- 2) 中继器：采样本 tick 已稳定的输入，决定是否输出 ----
      //       中继器在输入到达后的第 delay tick 输出；输出的那一 tick，
      //       其正前方导线格立即获得强度 15（同 tick）。
      const repeaterOut = new Set<string>();
      for (const [k, c] of this.grid) {
        if (c.kind !== 'repeater') continue;
        const here = parseKey(k);
        const inputPos: Vec3 = {
          x: here.x - FACING_DELTA[c.facing].x,
          y: here.y,
          z: here.z - FACING_DELTA[c.facing].z,
        };
        const inputPowered = (wirePower.get(key(inputPos)) ?? 0) > 0;

        if (inputPowered && !c.inputOn) {
          c.inputOn = true;
          c.fireAt = tick + c.delay;
        } else if (!inputPowered && c.inputOn) {
          c.inputOn = false;
          c.fireAt = null;
        }
        c.outputting = c.fireAt !== null && tick >= c.fireAt;
        if (c.outputting) {
          const outKey = key({
            x: here.x + FACING_DELTA[c.facing].x,
            y: here.y,
            z: here.z + FACING_DELTA[c.facing].z,
          });
          repeaterOut.add(outKey);
          if (wirePower.has(outKey)) wirePower.set(outKey, 15);
        }
      }

      // ---- 3) 音符盒触发检测 ----
      //       同层相邻有电（红石线有电 / 中继器输出指向它）才算被触发；
      //       且正上方必须是空气才发声 —— 上方被占时只更新状态、不出声。
      for (const [k, c] of this.grid) {
        if (c.kind !== 'note_block') continue;
        const here = parseKey(k);

        // 中继器输出**打进音符盒所在的那一格**，所以查的是自己这格；
        // 红石线则是同层相邻供电，所以查的是邻居。
        let powered = repeaterOut.has(k);
        if (!powered) {
          for (const d of HORIZONTAL) {
            const nk = key({ x: here.x + d.x, y: here.y, z: here.z + d.z });
            if ((wirePower.get(nk) ?? 0) > 0) {
              powered = true;
              break;
            }
          }
        }

        const above = this.cellAt({ x: here.x, y: here.y + 1, z: here.z });
        const sounds = powered && allowsSound(above);

        if (sounds && !(prevPowered.get(k) ?? false)) {
          events.push({ tick, pos: here, note: c.note });
        }
        prevPowered.set(k, sounds);
      }
    }

    return events;
  }
}

function parseKey(k: string): Vec3 {
  const [x, y, z] = k.split(',').map(Number);
  return { x: x!, y: y!, z: z! };
}
