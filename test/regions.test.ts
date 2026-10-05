import { describe, expect, it } from 'vitest';
import { sliceRegions } from '../src/core/layout/regions';
import { buildLitematic, parseLitematic, blockIndex } from '../src/core/litematic/build';
import { layout } from '../src/core/layout/index';
import { DEFAULT_REGIONS } from '../src/core/palette/pitchMap';
import type { SongModel } from '../src/core/midi/types';

/** 造一个指定 (tick, midi) 的 SongModel，不经过 MIDI 解析。 */
function song(notes: Array<{ tick: number; midi: number }>): SongModel {
  return {
    name: 'test',
    ppq: 480,
    durationSec: 1,
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
          timeSec: n.tick / 20,
          durationSec: 0.1,
          velocity: 1,
          channel: 0,
        })),
      },
    ],
  };
}

describe('sliceRegions', () => {
  it('region 内所有方块坐标均非负且落在 size 内', () => {
    // 3 音和弦会沿 ±Z 展开支线，历史 bug 就是这里产生负 z
    const res = layout(song([{ tick: 0, midi: 60 }, { tick: 0, midi: 64 }, { tick: 0, midi: 67 }]), {
      regions: DEFAULT_REGIONS,
    });

    const slices = sliceRegions(res);
    expect(slices.length).toBeGreaterThan(0);

    for (const s of slices) {
      for (const b of s.blocks) {
        expect(b.pos.x).toBeGreaterThanOrEqual(0);
        expect(b.pos.y).toBeGreaterThanOrEqual(0);
        expect(b.pos.z).toBeGreaterThanOrEqual(0);
        expect(b.pos.x).toBeLessThan(s.size.x);
        expect(b.pos.y).toBeLessThan(s.size.y);
        expect(b.pos.z).toBeLessThan(s.size.z);
      }
    }
  });

  it('切片可直接喂给 buildLitematic 而不抛越界', () => {
    const res = layout(song([{ tick: 0, midi: 60 }, { tick: 0, midi: 64 }, { tick: 0, midi: 67 }]), {
      regions: DEFAULT_REGIONS,
    });
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
      { name: 'chord', author: 't', description: '', dataVersion: 3700, version: 6 },
    );

    const parsed = parseLitematic(buf);
    expect(parsed.regions).toHaveLength(slices.length);

    // 回读后音符盒数量必须与切片一致，不能丢音符
    const expected = slices.reduce(
      (s, sl) => s + sl.blocks.filter((b) => b.block === 'minecraft:note_block').length,
      0,
    );
    let actual = 0;
    for (const r of parsed.regions) {
      for (let i = 0; i < r.indices.length; i++) {
        if (r.palette[r.indices[i]!]?.name === 'minecraft:note_block') actual++;
      }
    }
    expect(actual).toBe(expected);
    expect(actual).toBe(3);
  });

  it('多条音轨（密集拆轨）切片互不重叠且音符总数守恒', () => {
    // 制造密集段落，触发 layout() 的自动拆轨
    const notes: Array<{ tick: number; midi: number }> = [];
    for (let i = 0; i < 14; i++) {
      for (const m of [60, 64, 67]) notes.push({ tick: i, midi: m });
    }
    const res = layout(song(notes), { regions: DEFAULT_REGIONS });
    const slices = sliceRegions(res);

    const noteCount = slices.reduce(
      (s, sl) => s + sl.blocks.filter((b) => b.block === 'minecraft:note_block').length,
      0,
    );
    // layout 允许截断超上限的组，但不得凭空多出音符
    expect(noteCount).toBeGreaterThan(0);
    expect(noteCount).toBeLessThanOrEqual(notes.length);

    // 每个 region 的 z 区间不应与另一个完全重合（否则说明坐标没平移好）
    const zRanges = slices.map((s) => [s.position.z, s.position.z + s.size.z] as const);
    for (let i = 0; i < zRanges.length; i++) {
      for (let j = i + 1; j < zRanges.length; j++) {
        const [a0, a1] = zRanges[i]!;
        const [b0, b1] = zRanges[j]!;
        const overlap = Math.min(a1, b1) - Math.max(a0, b0);
        expect(overlap).toBeLessThanOrEqual(0);
      }
    }
  });

  it('回读的方块落在与原布局相同的相对位置', () => {
    const res = layout(song([{ tick: 0, midi: 60 }, { tick: 0, midi: 64 }, { tick: 0, midi: 67 }]), {
      regions: DEFAULT_REGIONS,
    });
    const slices = sliceRegions(res);
    const src = slices[0]!;

    const buf = buildLitematic(
      [
        {
          position: src.position,
          size: src.size,
          blocks: src.blocks.map((b) => ({
            x: b.pos.x,
            y: b.pos.y,
            z: b.pos.z,
            state: { name: b.block, properties: b.props ?? {} },
          })),
        },
      ],
      { name: 'x', author: 'x', description: '', dataVersion: 3700, version: 6 },
    );

    const r = parseLitematic(buf).regions[0]!;
    for (const b of src.blocks) {
      const got = r.palette[r.indices[blockIndex(b.pos.x, b.pos.y, b.pos.z, r.size.x, r.size.z)]!]!;
      expect(got.name).toBe(b.block);
    }
  });
});
