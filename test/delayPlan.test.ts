import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG, layout } from '../src/core/layout/index';
import { DEFAULT_REGIONS } from '../src/core/palette/pitchMap';
import { gameTickToRedstone } from '../src/core/layout/track';
import type { SongModel } from '../src/core/midi/types';

const cfg = { ...DEFAULT_LAYOUT_CONFIG };

function song(notes: Array<{ tick: number; midi: number }>): SongModel {
  return {
    name: 't',
    ppq: 480,
    durationSec: 8,
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

/** 主线行（z = zBase）上按 X 排序的中继器档位序列 */
function mainRepeaterDelays(res: ReturnType<typeof layout>, trackIdx = 0): number[] {
  const tr = res.tracks[trackIdx]!;
  return tr.placements
    .filter((p) => p.block === 'minecraft:repeater' && p.pos.z === tr.zBase)
    .sort((a, b) => a.pos.x - b.pos.x)
    .map((p) => Number(p.props?.delay));
}

describe('gameTickToRedstone（红刻量化：1 红刻 = 2 游刻 = 0.1s）', () => {
  it('四舍五入到 0.1s 网格', () => {
    expect([0, 1, 2, 3, 4, 5, 9, 10].map(gameTickToRedstone)).toEqual([0, 1, 1, 2, 2, 3, 5, 5]);
  });
});

describe('组间隔 → 中继器档位分解（红石粉 0 延迟，只有中继器计延迟）', () => {
  it('间隔 ≤4 红刻：单个末级中继器承担全部间隔', () => {
    // rt 0 与 rt 4（tick 0 与 8），整轨 +1 红刻前导：组 1 R1、组 2 R4
    const res = layout(
      song([
        { tick: 0, midi: 60 },
        { tick: 8, midi: 62 },
      ]),
      { config: cfg, regions: DEFAULT_REGIONS },
    );
    expect(mainRepeaterDelays(res)).toEqual([1, 4]);
  });

  it('间隔 >4 红刻：前置串联中继器（贪心 4 档）+ 末级中继器', () => {
    // rt 5 与 rt 10（tick 10 与 20），无前导：组 1 R(4+1)？gap=5 → rest=1,R4；
    // 组 2 gap=5 → rest=1,R4。主线档位序列 [1, 4, 1, 4]
    const res = layout(
      song([
        { tick: 10, midi: 60 },
        { tick: 20, midi: 62 },
      ]),
      { config: cfg, regions: DEFAULT_REGIONS },
    );
    expect(mainRepeaterDelays(res)).toEqual([1, 4, 1, 4]);
  });

  it('中继器档位总和 == 末组红刻 + 全曲前导（累计时序守恒）', () => {
    const ticks = [10, 23, 47, 100, 101, 260];
    const res = layout(song(ticks.map((t, i) => ({ tick: t, midi: 54 + (i % 5) }))), {
      config: cfg,
      regions: DEFAULT_REGIONS,
    });
    const delays = mainRepeaterDelays(res);
    const rts = ticks.map((t) => gameTickToRedstone(t));
    const base = rts[0] === 0 ? 1 : 0;
    const total = delays.reduce((s, d) => s + d, 0);
    expect(total).toBe(rts[rts.length - 1]! + base);
  });
});

describe('量化误差（不承诺零误差，但必须守恒且 ≤1 游刻/音）', () => {
  it('placed 全部落在红刻网格：actual = 2·(rt + base)', () => {
    const ticks = [0, 3, 7, 20, 55];
    const res = layout(song(ticks.map((t, i) => ({ tick: t, midi: 54 + (i % 5) }))), {
      config: cfg,
      regions: DEFAULT_REGIONS,
    });
    for (const p of res.placed) {
      const rt = gameTickToRedstone(p.tick);
      expect(p.actual - 2 * rt).toBe(2); // 首组 rt=0 → 全曲 base=1
    }
  });

  it('首组 rt=0：整轨 +1 红刻前导，报一条 TIMING_ADJUSTED', () => {
    const res = layout(song([{ tick: 0, midi: 60 }]), {
      config: cfg,
      regions: DEFAULT_REGIONS,
    });
    expect(res.placed[0]!.actual).toBe(2);
    const ta = res.warnings.filter((w) => w.code === 'TIMING_ADJUSTED');
    expect(ta).toHaveLength(1);
  });

  it('首组 rt≥1：无前导、无告警，actual == 原始游刻', () => {
    const res = layout(song([{ tick: 10, midi: 60 }]), {
      config: cfg,
      regions: DEFAULT_REGIONS,
    });
    expect(res.placed[0]!.actual).toBe(10);
    expect(res.warnings.some((w) => w.code === 'TIMING_ADJUSTED')).toBe(false);
  });

  it('相邻组实际触发差 == 2·(红刻差)，随机谱面 200 次', () => {
    for (let seed = 0; seed < 200; seed++) {
      let t = 0;
      const notes = [];
      for (let i = 0; i < 12; i++) {
        notes.push({ tick: t, midi: 54 + ((seed + i) % 8) });
        t += 1 + ((seed * 7 + i * 13) % 17);
      }
      const res = layout(song(notes), { config: cfg, regions: DEFAULT_REGIONS });
      const placed = [...res.placed].sort((a, b) => a.tick - b.tick);
      for (let i = 1; i < placed.length; i++) {
        const dExp =
          (gameTickToRedstone(placed[i]!.tick) - gameTickToRedstone(placed[i - 1]!.tick)) * 2;
        expect(placed[i]!.actual - placed[i - 1]!.actual).toBe(dExp);
      }
    }
  });
});
