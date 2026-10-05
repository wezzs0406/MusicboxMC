import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG, layout } from '../src/core/layout/index';
import { DEFAULT_REGIONS } from '../src/core/palette/pitchMap';
import { gameTickToRedstone } from '../src/core/layout/track';
import { buildLitematic } from '../src/core/litematic/build';
import { sliceRegions } from '../src/core/layout/regions';
import type { SongModel } from '../src/core/midi/types';

/**
 * 布局验收（不依赖 core/sim）。
 *
 * 重写任务 §5：旧模拟器把红石粉传播写成"每格一刻"，且未建模
 * "被中继器充能的音符盒向相邻红石粉供电"，不能作为新拓扑的时序依据。
 * 在游戏内实测（任务书 §6）补齐之前，自动化验收只锁两类不变量：
 *   1. 结构不变量：音符数守恒、跨轨不重叠、可导出合法 .litematic；
 *   2. 时序不变量：placed 相对时序与 MIDI 红刻量化严格一致（含跨轨）。
 */

const cfg = { ...DEFAULT_LAYOUT_CONFIG };

function song(tracks: Array<Array<{ tick: number; midi: number }>>): SongModel {
  return {
    name: 't',
    ppq: 480,
    durationSec: 8,
    baseBpm: 120,
    tempos: [{ ticks: 0, timeSec: 0, bpm: 120 }],
    timeSignature: null,
    tracks: tracks.map((notes, i) => ({
      index: i,
      name: `t${i}`,
      channel: i,
      instrument: 'acoustic grand piano',
      percussion: false,
      notes: notes.map((n) => ({
        midi: n.midi,
        timeSec: n.tick / cfg.baseTps,
        durationSec: 0.1,
        velocity: 1,
        channel: i,
      })),
    })),
  };
}

function noteBlockCount(res: ReturnType<typeof layout>): number {
  return res.tracks.reduce(
    (s, t) => s + t.placements.filter((p) => p.block === 'minecraft:note_block').length,
    0,
  );
}

describe('布局验收：结构与音符守恒', () => {
  it('单音/和弦/密集谱面：音符数守恒', () => {
    const cases = [
      [{ tick: 0, midi: 60 }],
      [60, 64, 67].map((midi) => ({ tick: 0, midi })),
      Array.from({ length: 40 }, (_, i) => ({ tick: i * 2, midi: 54 + (i % 9) })),
      Array.from({ length: 35 }, (_, i) => ({ tick: 0, midi: 48 + (i % 12) })),
    ];
    for (const notes of cases) {
      const res = layout(song([notes]), { config: cfg, regions: DEFAULT_REGIONS });
      expect(noteBlockCount(res)).toBe(notes.length);
    }
  });

  it('所有轨的 Z 区间互不重叠（含 overflow 拆出的新轨）', () => {
    const res = layout(
      song([
        Array.from({ length: 35 }, (_, i) => ({ tick: 0, midi: 48 + (i % 12) })),
        [{ tick: 4, midi: 60 }],
      ]),
      { config: cfg, regions: DEFAULT_REGIONS },
    );
    expect(res.tracks.length).toBeGreaterThanOrEqual(2);
    const ranges = res.tracks.map((t) => {
      const zs = t.placements.map((p) => p.pos.z);
      return [Math.min(...zs), Math.max(...zs)] as const;
    });
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const overlap =
          Math.min(ranges[i]![1], ranges[j]![1]) - Math.max(ranges[i]![0], ranges[j]![0]);
        expect(overlap).toBeLessThanOrEqual(0);
      }
    }
  });

  it('可导出合法 .litematic（region 坐标非负、音符盒不丢）', () => {
    const res = layout(
      song([
        [{ tick: 0, midi: 60 }],
        [
          { tick: 0, midi: 64 },
          { tick: 0, midi: 67 },
        ],
      ]),
      { config: cfg, regions: DEFAULT_REGIONS },
    );
    const slices = sliceRegions(res);
    const buf = buildLitematic(
      slices.map((s) => ({
        position: s.position,
        size: s.size,
        blocks: s.blocks.map((b) => ({
          x: b.pos.x,
          y: b.pos.y,
          z: b.pos.z,
          state: { name: b.block, properties: b.props ?? {} },
        })),
      })),
      { name: 'acc', author: 't', description: '', dataVersion: 3700, version: 6 },
    );
    expect(buf.length).toBeGreaterThan(0);
    for (const s of slices) {
      for (const b of s.blocks) {
        expect(b.pos.x).toBeGreaterThanOrEqual(0);
        expect(b.pos.y).toBeGreaterThanOrEqual(0);
        expect(b.pos.z).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('布局验收：时序不变量', () => {
  it('跨轨相对时序守恒：轨 A 首音 rt0、轨 B 首音 rt10，实际差必须为 20 游刻', () => {
    // 锁住"全曲统一前导"：中继器最小 1 档使 rt0 的音只能 1 红刻后发声，
    // 前导必须全曲统一，否则不同轨的首音偏移会互相不一致。
    const res = layout(
      song([
        [{ tick: 0, midi: 60 }],
        [{ tick: 20, midi: 62 }],
      ]),
      { config: cfg, regions: DEFAULT_REGIONS },
    );
    const a = res.placed.find((p) => p.trackIndex === 0)!;
    const b = res.placed.find((p) => p.trackIndex === 1)!;
    expect(a.actual).toBe(2); // rt 0 + 全曲前导 1 红刻
    expect(b.actual).toBe(22); // rt 10 + 同一前导
    expect(b.actual - a.actual).toBe(20);
  });

  it('随机谱面：每轨相邻组 actual 差 == 2·(红刻差)', () => {
    for (let seed = 0; seed < 100; seed++) {
      const notes = [];
      let t = seed % 4;
      for (let i = 0; i < 15; i++) {
        notes.push({ tick: t, midi: 54 + ((seed + i) % 9) });
        t += 1 + ((seed * 11 + i * 7) % 23);
      }
      const res = layout(song([notes]), { config: cfg, regions: DEFAULT_REGIONS });
      const placed = [...res.placed].sort((a, b) => a.tick - b.tick);
      expect(placed.length).toBeGreaterThan(0);
      for (let i = 1; i < placed.length; i++) {
        const dExp =
          (gameTickToRedstone(placed[i]!.tick) - gameTickToRedstone(placed[i - 1]!.tick)) * 2;
        expect(placed[i]!.actual - placed[i - 1]!.actual).toBe(dExp);
      }
    }
  });

  it('和弦组只报一条 placed，触发红刻 == 量化红刻', () => {
    const notes = [60, 64, 67, 70].map((midi) => ({ tick: 12, midi }));
    const res = layout(song([notes]), { config: cfg, regions: DEFAULT_REGIONS });
    expect(res.placed).toHaveLength(1);
    expect(res.placed[0]!.actual).toBe(12); // rt 6（tick 12）；首组 rt≥1 → 无前导
  });
});
