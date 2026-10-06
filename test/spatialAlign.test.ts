import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG, layout } from '../src/core/layout/index';
import { DEFAULT_REGIONS } from '../src/core/palette/pitchMap';
import { ALIGN_TOLERANCE_CELLS, gameTickToRedstone } from '../src/core/layout/track';
import type { SongModel } from '../src/core/midi/types';

/**
 * 多轨空间对齐（多轨空间对齐目标.md）
 *
 * 目标：各轨的 X 由**同一曲中时刻**决定，同一段音乐的各轨活动区域保持靠近，
 * 不随曲长持续发散。手段只有"补红石线"（0 延迟）——不跨轨接线、
 * 不改中继器时值、不靠补齐末端。
 */

const cfg = { ...DEFAULT_LAYOUT_CONFIG };

function song(tracks: Array<Array<{ tick: number; midi: number }>>): SongModel {
  return {
    name: 't',
    ppq: 480,
    durationSec: 60,
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

/** 某轨各音组的（曲中红刻, 音符列 X）。taps[].x 是分线列，音符列在其 +2 处 */
function noteXs(res: ReturnType<typeof layout>, trackIdx: number): Array<{ rt: number; x: number }> {
  const tr = res.tracks[trackIdx]!;
  return tr.segments[0]!.taps.map((t) => ({ rt: t.t, x: t.x + 2 }));
}

/** 该轨在 rt 时刻（取最后一个不晚于 rt 的音组）的 X */
function xAt(samples: Array<{ rt: number; x: number }>, rt: number): number | undefined {
  let hit: number | undefined;
  for (const s of samples) {
    if (s.rt <= rt) hit = s.x;
    else break;
  }
  return hit;
}

describe('多轨空间对齐：X 由曲中时刻决定', () => {
  it('密度悬殊的两轨：全曲各段 X 差被限制在局部范围，且不随曲长增长', () => {
    // A：每 2 红刻一个音（密集）；B：每 40 红刻一个音（稀疏）
    const aNotes = [];
    const bNotes = [];
    for (let rt = 1; rt <= 120; rt++) {
      if (rt % 2 === 0) aNotes.push({ tick: rt * 2, midi: 60 });
      if (rt % 40 === 0) bNotes.push({ tick: rt * 2, midi: 67 });
    }
    const res = layout(song([aNotes, bNotes]), { config: cfg, regions: DEFAULT_REGIONS });

    const a = noteXs(res, 0);
    const b = noteXs(res, 1);
    expect(b.length).toBeGreaterThan(2);

    const deltas: Array<{ rt: number; d: number }> = [];
    for (const s of b) {
      const xa = xAt(a, s.rt);
      if (xa === undefined) continue;
      deltas.push({ rt: s.rt, d: Math.abs(xa - s.x) });
    }
    expect(deltas.length).toBe(b.length);

    // 全程有界（留 6 格给密集轨组内偏移）
    for (const d of deltas) expect(d.d).toBeLessThanOrEqual(ALIGN_TOLERANCE_CELLS + 6);

    // 不持续增长：后 1/3 的最大偏差不大于前 1/3 + 4
    const third = Math.floor(deltas.length / 3);
    const maxOf = (arr: Array<{ d: number }>) => Math.max(...arr.map((v) => v.d));
    const early = maxOf(deltas.slice(0, third));
    const late = maxOf(deltas.slice(-third));
    expect(late).toBeLessThanOrEqual(early + 4);
  });

  it('长休止后重新进入：回到同一局部区域，且休止时长保持不变', () => {
    // A 全程密集；B 在 rt 1..20 演奏，休止 200 红刻，再从 rt 220 继续
    const aNotes = [];
    for (let rt = 1; rt <= 240; rt++) aNotes.push({ tick: rt * 2, midi: 60 });
    const bNotes = [];
    for (let rt = 1; rt <= 20; rt += 2) bNotes.push({ tick: rt * 2, midi: 67 });
    for (let rt = 220; rt <= 240; rt += 2) bNotes.push({ tick: rt * 2, midi: 67 });

    const res = layout(song([aNotes, bNotes]), { config: cfg, regions: DEFAULT_REGIONS });
    const a = noteXs(res, 0);
    const b = noteXs(res, 1);

    // 重新进入时（后半段）仍在同一局部区域
    const rejoined = b.filter((s) => s.rt >= 220);
    expect(rejoined.length).toBeGreaterThan(0);
    for (const s of rejoined) {
      const xa = xAt(a, s.rt);
      expect(Math.abs(xa! - s.x)).toBeLessThanOrEqual(ALIGN_TOLERANCE_CELLS + 6);
    }

    // 休止时长不变：跨休止的两个音，实际触发差 == 2·红刻差
    const placedB = res.placed.filter((p) => p.trackIndex === 1).sort((x, y) => x.tick - y.tick);
    const firstSection = placedB.filter((p) => p.tick < 100);
    const beforeRest = firstSection[firstSection.length - 1]!; // rt 19（tick 38）
    const afterRest = placedB.find((p) => p.tick === 440)!; // rt 220
    expect(afterRest.actual - beforeRest.actual).toBe(2 * (220 - 19));
  });

  it('提前结束的轨不补到别轨末端，但活动期间仍对齐', () => {
    const aNotes = [];
    for (let rt = 1; rt <= 100; rt += 2) aNotes.push({ tick: rt * 2, midi: 60 });
    const bNotes = [];
    for (let rt = 1; rt <= 20; rt += 4) bNotes.push({ tick: rt * 2, midi: 67 });

    const res = layout(song([aNotes, bNotes]), { config: cfg, regions: DEFAULT_REGIONS });
    const a = noteXs(res, 0);
    const b = noteXs(res, 1);

    // 活动期间对齐
    for (const s of b) {
      expect(Math.abs(xAt(a, s.rt)! - s.x)).toBeLessThanOrEqual(ALIGN_TOLERANCE_CELLS + 6);
    }
    // 不要求末端齐平：B 的末端 X 明显小于 A 的末端 X
    const aEnd = a[a.length - 1]!.x;
    const bEnd = b[b.length - 1]!.x;
    expect(bEnd).toBeLessThan(aEnd);
  });

  it('补齐只用红石线：时序与中继器档位完全不变', () => {
    const aNotes = [];
    for (let rt = 1; rt <= 60; rt += 2) aNotes.push({ tick: rt * 2, midi: 60 });
    const bNotes = [];
    for (let rt = 4; rt <= 60; rt += 20) bNotes.push({ tick: rt * 2, midi: 67 });

    const res = layout(song([aNotes, bNotes]), { config: cfg, regions: DEFAULT_REGIONS });

    // 每轨相邻音组的实际触发差 == 2·红刻差（补齐没有改变任何时刻）
    for (const trackIdx of [0, 1]) {
      const placed = res.placed
        .filter((p) => p.trackIndex === trackIdx)
        .sort((x, y) => x.tick - y.tick);
      for (let i = 1; i < placed.length; i++) {
        const dExp =
          (gameTickToRedstone(placed[i]!.tick) - gameTickToRedstone(placed[i - 1]!.tick)) * 2;
        expect(placed[i]!.actual - placed[i - 1]!.actual).toBe(dExp);
      }
    }

    // 无时序类告警（除整轨前导那一条），也不该出现空间偏差报告
    expect(res.warnings.filter((w) => w.code === 'TIMING_ADJUSTED').length).toBeLessThanOrEqual(1);
    expect(res.warnings.some((w) => w.code === 'SPATIAL_DRIFT')).toBe(false);
  });

  it('同刻两轨的自然位置在 10 格内时，音符列强制共用 X 轴', () => {
    const res = layout(
      song([
        [5, 10, 15, 20].map((rt) => ({ tick: rt * 2, midi: 60 })),
        [10, 20].map((rt) => ({ tick: rt * 2, midi: 67 })),
      ]),
      { config: cfg, regions: DEFAULT_REGIONS },
    );
    const a = noteXs(res, 0);
    const b = noteXs(res, 1);
    for (const rt of [10, 20]) {
      expect(a.find((sample) => sample.rt === rt)?.x).toBe(
        b.find((sample) => sample.rt === rt)?.x,
      );
    }
  });

  it('同刻两轨的自然位置超过 10 格时，仍尽量补线共用 X 轴', () => {
    // 密集轨在 rt=20 已经走得更远，稀疏轨的自然位置差超过旧窗口；
    // 只要当前组的红石线槽位放得下，仍应把同刻音符列补到同一 X。
    const res = layout(
      song([
        [2, 4, 6, 8, 10, 12, 14, 16, 18, 20].map((rt) => ({
          tick: rt * 2,
          midi: 60,
        })),
        [10, 20].map((rt) => ({ tick: rt * 2, midi: 67 })),
      ]),
      { config: cfg, regions: DEFAULT_REGIONS },
    );
    const a = noteXs(res, 0);
    const b = noteXs(res, 1);

    expect(Math.abs(a.find((sample) => sample.rt === 20)!.x - 20)).toBe(0);
    expect(b.find((sample) => sample.rt === 20)?.x).toBe(
      a.find((sample) => sample.rt === 20)?.x,
    );
    expect(res.warnings.some((w) => w.code === 'SPATIAL_DRIFT')).toBe(false);
  });

  it('单轨曲目不产生多余补齐（参考线就是它自己）', () => {
    const notes = [];
    for (let rt = 1; rt <= 50; rt += 5) notes.push({ tick: rt * 2, midi: 60 });
    const res = layout(song([notes]), { config: cfg, regions: DEFAULT_REGIONS });
    const tr = res.tracks[0]!;
    const maxX = Math.max(...tr.placements.map((p) => p.pos.x));
    // 首组 gap=1（首音 rt1）→ 中继器+音符盒 = 2 格；
    // 其余 gap=5 → rest 1 个中继器 + 中继器 + 音符盒 = 3 格/组（无分线列）
    const expected = 2 + (notes.length - 1) * 3 - 1;
    expect(maxX).toBe(expected);
  });
});
