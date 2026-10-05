import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG, layout } from '../src/core/layout/index';
import { DEFAULT_REGIONS } from '../src/core/palette/pitchMap';
import type { SongModel } from '../src/core/midi/types';

const cfg = { ...DEFAULT_LAYOUT_CONFIG };

function song(notes: Array<{ tick: number; midi: number }>): SongModel {
  return {
    name: 't',
    ppq: 480,
    durationSec: 4,
    baseBpm: 120,
    tempos: [{ ticks: 0, timeSec: 0, bpm: 120 }],
    timeSignature: null,
    tracks: [
      {
        index: 0,
        name: 'p',
        channel: 0,
        instrument: 'acoustic grand piano',
        percussion: false,
        notes: notes.map((n) => ({
          midi: n.midi,
          timeSec: n.tick / cfg.baseTps,
          durationSec: 0.1,
          velocity: 1,
          channel: 0,
        })),
      },
    ],
  };
}

/** 单音 / 三音和弦 / 五音和弦 / 混合间隔，覆盖内联与分支行两类几何 */
const CASES: Array<Array<{ tick: number; midi: number }>> = [
  [{ tick: 0, midi: 60 }],
  [
    { tick: 0, midi: 60 },
    { tick: 0, midi: 64 },
    { tick: 0, midi: 67 },
  ],
  [60, 62, 64, 65, 67].map((midi) => ({ tick: 6, midi })),
  [
    { tick: 0, midi: 60 },
    { tick: 6, midi: 62 },
    { tick: 6, midi: 64 },
    { tick: 30, midi: 65 },
  ],
];

/** 某轨电路层（y=circuitY）上 (x, z 相对 zBase) 处的方块 */
function at(
  res: ReturnType<typeof layout>,
  trackIdx: number,
  x: number,
  zRel: number,
): { block: string; props?: Record<string, string> } | undefined {
  const tr = res.tracks[trackIdx]!;
  return tr.placements.find(
    (p) => p.pos.x === x && p.pos.y === cfg.circuitY && p.pos.z === tr.zBase + zRel,
  );
}

describe('音符电路几何（新拓扑：音符盒内联主线，分支行中继器直接供电）', () => {
  it('音符盒正上方必须是空气，否则不发声', () => {
    for (const notes of CASES) {
      const res = layout(song(notes), { config: cfg, regions: DEFAULT_REGIONS });
      for (const tr of res.tracks) {
        const occupied = new Set(tr.placements.map((p) => `${p.pos.x},${p.pos.y},${p.pos.z}`));
        for (const p of tr.placements) {
          if (p.block !== 'minecraft:note_block') continue;
          expect(occupied.has(`${p.pos.x},${p.pos.y + 1},${p.pos.z}`)).toBe(false);
        }
      }
    }
  });

  it('电路层每个方块下方必须有支撑（红石线/中继器/音符盒都不悬空）', () => {
    for (const notes of CASES) {
      const res = layout(song(notes), { config: cfg, regions: DEFAULT_REGIONS });
      for (const tr of res.tracks) {
        const occupied = new Set(tr.placements.map((p) => `${p.pos.x},${p.pos.y},${p.pos.z}`));
        for (const p of tr.placements) {
          if (p.pos.y !== cfg.circuitY) continue;
          expect(occupied.has(`${p.pos.x},${p.pos.y - 1},${p.pos.z}`)).toBe(true);
        }
      }
    }
  });

  it('全部中继器 facing=west（输入朝 −X 线列，输出朝 +X 音符盒）且档位 1–4', () => {
    for (const notes of CASES) {
      const res = layout(song(notes), { config: cfg, regions: DEFAULT_REGIONS });
      for (const tr of res.tracks) {
        for (const p of tr.placements) {
          if (p.block !== 'minecraft:repeater') continue;
          expect(p.props?.facing).toBe('west');
          const delay = Number(p.props?.delay);
          expect(delay).toBeGreaterThanOrEqual(1);
          expect(delay).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  it('单音主线：[中继器][音符盒] 沿 +X（不需要分线列，输入取自背后的方块）', () => {
    // 首组 rt=0 → 整轨 +1 红刻前导；组 1 占 x=0..1，全程无红石粉
    const res = layout(song([{ tick: 0, midi: 60 }]), { config: cfg, regions: DEFAULT_REGIONS });
    expect(at(res, 0, 0, 0)?.block).toBe('minecraft:repeater');
    expect(at(res, 0, 1, 0)?.block).toBe('minecraft:note_block');
    expect(
      res.tracks[0]!.placements.some((p) => p.block === 'minecraft:redstone_wire'),
    ).toBe(false);
  });

  it('起始那格红石粉保留（首组有前置中继器时作为接电点）', () => {
    // 首音 rt=5（tick 10）→ 组前有中继器 ⇒ 先铺一格起始线给玩家接电源
    const res = layout(song([{ tick: 10, midi: 60 }]), { config: cfg, regions: DEFAULT_REGIONS });
    expect(at(res, 0, 0, 0)?.block).toBe('minecraft:redstone_wire');
    expect(res.tracks[0]!.placements.filter((p) => p.block === 'minecraft:redstone_wire')).toHaveLength(1);
  });

  it('≤3 个音：只用一个中继器充能内联（中间）那个，相邻行由一跳传导点亮', () => {
    // 三音和弦：内联行 + 上下相邻行，只有一个中继器、一条线
    const res = layout(
      song([
        { tick: 0, midi: 60 },
        { tick: 0, midi: 64 },
        { tick: 0, midi: 67 },
      ]),
      { config: cfg, regions: DEFAULT_REGIONS },
    );
    // 主线行：中继器 → 音符盒（无分线列）
    expect(at(res, 0, 0, 0)?.block).toBe('minecraft:repeater');
    // 三行都是音符盒（内联 + 上下传导行）
    for (const zRel of [-1, 0, 1]) {
      expect(at(res, 0, 1, zRel)?.block).toBe('minecraft:note_block');
    }
    // 传导行不放线、不放中继器
    for (const zRel of [-1, 1]) {
      expect(at(res, 0, 0, zRel)).toBeUndefined();
    }
    // 整轨只有 1 个中继器、0 格红石粉
    const tr = res.tracks[0]!;
    expect(tr.placements.filter((p) => p.block === 'minecraft:repeater')).toHaveLength(1);
    expect(tr.placements.filter((p) => p.block === 'minecraft:redstone_wire')).toHaveLength(0);
  });

  it('2 个音同样走传导：1 个中继器 + 相邻两格音符盒', () => {
    const res = layout(
      song([
        { tick: 0, midi: 60 },
        { tick: 0, midi: 64 },
      ]),
      { config: cfg, regions: DEFAULT_REGIONS },
    );
    expect(at(res, 0, 1, 0)?.block).toBe('minecraft:note_block');
    expect(at(res, 0, 1, 1)?.block).toBe('minecraft:note_block');
    expect(at(res, 0, 0, 1)).toBeUndefined();
    const repeaters = res.tracks[0]!.placements.filter(
      (p) => p.block === 'minecraft:repeater',
    ).length;
    expect(repeaters).toBe(1);
  });

  it('≥4 个音：回到分支模式，每个额外音各占一行、各配一个中继器', () => {
    const res4 = layout(song([60, 64, 67, 69].map((midi) => ({ tick: 0, midi }))), {
      config: cfg,
      regions: DEFAULT_REGIONS,
    });
    // 分支行 -1 / +1 / +2 各带线与中继器
    for (const zRel of [-1, 0, 1, 2]) {
      expect(at(res4, 0, 2, zRel)?.block).toBe('minecraft:note_block');
      expect(at(res4, 0, 0, zRel)?.block).toBe('minecraft:redstone_wire');
      expect(at(res4, 0, 1, zRel)?.block).toBe('minecraft:repeater');
    }
    expect(at(res4, 0, 2, -2)?.block).toBeUndefined();
    const repeaters = res4.tracks[0]!.placements.filter(
      (p) => p.block === 'minecraft:repeater',
    ).length;
    expect(repeaters).toBe(4);
  });

  it('投影是未通电的初始状态：红石粉一律 power=0，中继器/音符盒 powered=false', () => {
    for (const notes of CASES) {
      const res = layout(song(notes), { config: cfg, regions: DEFAULT_REGIONS });
      for (const tr of res.tracks) {
        for (const p of tr.placements) {
          if (p.block === 'minecraft:redstone_wire') expect(p.props?.power).toBe('0');
          if (p.block === 'minecraft:repeater') expect(p.props?.powered).toBe('false');
          if (p.block === 'minecraft:note_block') expect(p.props?.powered).toBe('false');
        }
      }
    }
  });

  it('音符数守恒：不凭空丢音、不凭空多音（截断上限内）', () => {
    for (const notes of CASES) {
      const res = layout(song(notes), { config: cfg, regions: DEFAULT_REGIONS });
      const nb = res.tracks.reduce(
        (s, t) => s + t.placements.filter((p) => p.block === 'minecraft:note_block').length,
        0,
      );
      expect(nb).toBe(notes.length);
    }
  });

  it('音符盒显式写入资源包所需的 instrument blockstate', () => {
    const res = layout(song([{ tick: 0, midi: 30 }, { tick: 2, midi: 54 }, { tick: 4, midi: 78 }]), {
      config: cfg,
      regions: DEFAULT_REGIONS,
    });
    const instruments = res.tracks[0]!.placements
      .filter((p) => p.block === 'minecraft:note_block')
      .map((p) => p.props?.instrument);
    expect(instruments).toEqual(['bass', 'guitar', 'flute']);
  });
});
