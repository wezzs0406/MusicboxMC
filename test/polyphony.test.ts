import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_CONFIG, layout } from '../src/core/layout/index';
import { DEFAULT_REGIONS } from '../src/core/palette/pitchMap';
import {
  branchRow,
  buildTrack,
  chordRowLayout,
  chordRows,
  MAX_CHORD_NOTES,
  MAX_SIDE_ROWS,
} from '../src/core/layout/track';
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

describe('branchRow / chordRows（分线列行分配）', () => {
  it('行分配沿 +1, −1, +2, −2, … 两侧交替', () => {
    expect([0, 1, 2, 3, 4, 5].map(branchRow)).toEqual([
      { side: 1, row: 1 },
      { side: -1, row: 1 },
      { side: 1, row: 2 },
      { side: -1, row: 2 },
      { side: 1, row: 3 },
      { side: -1, row: 3 },
    ]);
  });

  it('chordRows = 向单侧延伸的行数（ceil((n−1)/2)）', () => {
    expect(chordRows(0)).toBe(0);
    expect(chordRows(1)).toBe(0);
    expect(chordRows(2)).toBe(1);
    expect(chordRows(3)).toBe(1);
    expect(chordRows(4)).toBe(2);
    expect(chordRows(29)).toBe(14);
  });

  it('单列容量来自信号强度物理上限：1 内联 + 两侧 MAX_SIDE_ROWS 行', () => {
    expect(MAX_SIDE_ROWS).toBe(14);
    expect(MAX_CHORD_NOTES).toBe(2 * MAX_SIDE_ROWS + 1);
  });
});

describe('chordRowLayout（≤3 音走一跳传导，≥4 音走分支行）', () => {
  it('n=1：只有内联音', () => {
    expect(chordRowLayout(1)).toEqual([]);
  });

  it('n=2 / n=3：全部是传导行（不放线、不放中继器）', () => {
    expect(chordRowLayout(2)).toEqual([{ side: 1, row: 1, conducted: true }]);
    expect(chordRowLayout(3)).toEqual([
      { side: -1, row: 1, conducted: true },
      { side: 1, row: 1, conducted: true },
    ]);
    for (const n of [2, 3]) {
      for (const r of chordRowLayout(n)) expect(r.conducted).toBe(true);
    }
  });

  it('n≥4：全部是分支行（各配一个中继器），行序 +1,−1,+2,−2…', () => {
    const rows = chordRowLayout(4);
    expect(rows.every((r) => !r.conducted)).toBe(true);
    expect(rows.map((r) => r.side * r.row)).toEqual([1, -1, 2]);
  });

  it('单侧行数不超过 chordRows（Z 跨度不变）', () => {
    for (let n = 2; n <= 29; n++) {
      const rows = chordRowLayout(n);
      expect(Math.max(...rows.map((r) => r.row))).toBe(chordRows(n));
      expect(rows.length).toBe(n - 1);
    }
  });
});

describe('和弦容量与 overflow 拆轨', () => {
  it('MAX_CHORD_NOTES 音的和弦放在单轨上，不产生容量告警', () => {
    const notes = Array.from({ length: MAX_CHORD_NOTES }, (_, i) => ({
      tick: 0,
      midi: 48 + (i % 12),
    }));
    const res = layout(song(notes), { config: cfg, regions: DEFAULT_REGIONS });
    expect(res.tracks).toHaveLength(1);
    expect(res.warnings.some((w) => w.code === 'POLYPHONY_EXCEEDED')).toBe(false);
    const nb = res.tracks[0]!.placements.filter((p) => p.block === 'minecraft:note_block').length;
    expect(nb).toBe(MAX_CHORD_NOTES);
  });

  it('超容量的部分改派新轨（TRACK_SPLIT），音符不丢', () => {
    const notes = Array.from({ length: MAX_CHORD_NOTES + 5 }, (_, i) => ({
      tick: 0,
      midi: 48 + (i % 12),
    }));
    const res = layout(song(notes), { config: cfg, regions: DEFAULT_REGIONS });
    expect(res.tracks).toHaveLength(2);
    expect(res.warnings.some((w) => w.code === 'POLYPHONY_EXCEEDED')).toBe(true);
    const nb = res.tracks.reduce(
      (s, t) => s + t.placements.filter((p) => p.block === 'minecraft:note_block').length,
      0,
    );
    expect(nb).toBe(notes.length);
  });

  it('collectOverflow=false 时超容量部分被截断并告警（不抛错）', () => {
    const notes = Array.from({ length: MAX_CHORD_NOTES + 3 }, (_, i) => ({
      tick: 0,
      midi: 48 + (i % 12),
    }));
    const res = buildTrack({
      trackIndex: 0,
      zBase: 0,
      notes: notes.map((n) => ({ tick: n.tick, midi: n.midi })),
      config: cfg,
      regions: DEFAULT_REGIONS,
      resolve: () => 'minecraft:dirt',
    });
    expect(res.warnings.some((w) => w.code === 'POLYPHONY_EXCEEDED')).toBe(true);
    expect(res.overflow).toHaveLength(0);
    const nb = res.track.placements.filter((p) => p.block === 'minecraft:note_block').length;
    expect(nb).toBe(MAX_CHORD_NOTES);
  });
});

describe('音组归并与音域处理', () => {
  it('同一红刻内的音符合为一组（tick 1 与 2 均量化到 rt 1）', () => {
    const res = layout(
      song([
        { tick: 1, midi: 60 },
        { tick: 2, midi: 64 },
      ]),
      { config: cfg, regions: DEFAULT_REGIONS },
    );
    expect(res.placed).toHaveLength(1);
    const nb = res.tracks[0]!.placements.filter((p) => p.block === 'minecraft:note_block').length;
    expect(nb).toBe(2);
  });

  it('outOfRange=drop：超出音域的音丢弃并告警，其余照常落位', () => {
    // B 区 54..78，A 区 30..54，C 区 78..102；midi 10 超出全部音区
    const res = buildTrack({
      trackIndex: 0,
      zBase: 0,
      notes: [
        { tick: 0, midi: 10 },
        { tick: 10, midi: 60 },
      ],
      config: cfg,
      regions: DEFAULT_REGIONS,
      resolve: () => 'minecraft:dirt',
      outOfRange: 'drop',
    });
    expect(res.warnings.some((w) => w.code === 'OUT_OF_RANGE' && w.midi === 10)).toBe(true);
    const nb = res.track.placements.filter((p) => p.block === 'minecraft:note_block').length;
    expect(nb).toBe(1);
  });
});
