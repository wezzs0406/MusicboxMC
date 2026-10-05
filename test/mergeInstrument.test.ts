import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG, layout } from '../src/core/layout/index';
import { DEFAULT_REGIONS } from '../src/core/palette/pitchMap';
import type { SongModel } from '../src/core/midi/types';

/**
 * 同乐器并轨（可选功能，默认关闭）
 *
 * 乐器相同的 MIDI 轨合并成一条主线：这些音本来就落在同一条线上，
 * 不再有跨轨 X 漂移；打击乐单独归一类。
 */

const cfg = { ...DEFAULT_LAYOUT_CONFIG };

interface TrackSpec {
  instrument?: string;
  percussion?: boolean;
  notes: Array<{ tick: number; midi: number }>;
}

function song(tracks: TrackSpec[]): SongModel {
  return {
    name: 't',
    ppq: 480,
    durationSec: 30,
    baseBpm: 120,
    tempos: [{ ticks: 0, timeSec: 0, bpm: 120 }],
    timeSignature: null,
    tracks: tracks.map((spec, i) => ({
      index: i,
      name: `t${i}`,
      channel: spec.percussion ? 9 : i,
      instrument: spec.instrument ?? 'unknown',
      percussion: spec.percussion ?? false,
      notes: spec.notes.map((n) => ({
        midi: n.midi,
        timeSec: n.tick / cfg.baseTps,
        durationSec: 0.1,
        velocity: 1,
        channel: spec.percussion ? 9 : i,
      })),
    })),
  };
}

function noteBlocks(res: ReturnType<typeof layout>): number {
  return res.tracks.reduce(
    (s, t) => s + t.placements.filter((p) => p.block === 'minecraft:note_block').length,
    0,
  );
}

describe('同乐器并轨', () => {
  it('默认关闭：每轨一条线', () => {
    const res = layout(
      song([
        { instrument: 'Acoustic Grand Piano', notes: [{ tick: 0, midi: 60 }] },
        { instrument: 'Acoustic Grand Piano', notes: [{ tick: 20, midi: 64 }] },
      ]),
      { config: cfg, regions: DEFAULT_REGIONS },
    );
    expect(res.tracks).toHaveLength(2);
    expect(noteBlocks(res)).toBe(2);
  });

  it('开启：同乐器的两轨合并为一条主线，音符守恒', () => {
    const res = layout(
      song([
        { instrument: 'Acoustic Grand Piano', notes: [{ tick: 0, midi: 60 }] },
        { instrument: 'Acoustic Grand Piano', notes: [{ tick: 20, midi: 64 }] },
      ]),
      { config: cfg, regions: DEFAULT_REGIONS, mergeSameInstrument: true },
    );
    expect(res.tracks).toHaveLength(1);
    expect(noteBlocks(res)).toBe(2);
  });

  it('不同乐器不合并', () => {
    const res = layout(
      song([
        { instrument: 'Acoustic Grand Piano', notes: [{ tick: 0, midi: 60 }] },
        { instrument: 'Violin', notes: [{ tick: 0, midi: 64 }] },
      ]),
      { config: cfg, regions: DEFAULT_REGIONS, mergeSameInstrument: true },
    );
    expect(res.tracks).toHaveLength(2);
  });

  it('打击乐单独归为一类，不与旋律音色混', () => {
    const res = layout(
      song([
        { instrument: 'Acoustic Grand Piano', notes: [{ tick: 0, midi: 60 }] },
        { instrument: 'Steel Drums', percussion: true, notes: [{ tick: 0, midi: 40 }] },
        { instrument: 'Woodblock', percussion: true, notes: [{ tick: 20, midi: 42 }] },
      ]),
      { config: cfg, regions: DEFAULT_REGIONS, mergeSameInstrument: true },
    );
    // 旋律一条 + 打击乐合并成一条
    expect(res.tracks).toHaveLength(2);
    expect(noteBlocks(res)).toBe(3);
  });

  it('合并后同刻音变为和弦（走同一分线列），超容量仍按既有规则拆轨且不丢音', () => {
    const notes = Array.from({ length: 40 }, (_, i) => ({ tick: 0, midi: 48 + (i % 12) }));
    const res = layout(song([{ instrument: 'Piano', notes }, { instrument: 'Piano', notes }]), {
      config: cfg,
      regions: DEFAULT_REGIONS,
      mergeSameInstrument: true,
    });
    // 80 音同刻 → 单列容量 29 → 拆成多条线，但音符不丢
    expect(res.tracks.length).toBeGreaterThanOrEqual(3);
    expect(noteBlocks(res)).toBe(80);
  });

  it('合并后该轨沿用组内第一个原轨的 index', () => {
    const res = layout(
      song([
        { instrument: 'Piano', notes: [{ tick: 0, midi: 60 }] },
        { instrument: 'Piano', notes: [{ tick: 20, midi: 64 }] },
        { instrument: 'Violin', notes: [{ tick: 40, midi: 67 }] },
      ]),
      { config: cfg, regions: DEFAULT_REGIONS, mergeSameInstrument: true },
    );
    expect(res.tracks.map((t) => t.trackIndex)).toEqual([0, 2]);
  });
});
