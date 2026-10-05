import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { readNbt } from '../src/core/nbt/reader';
import { buildLitematic } from '../src/core/litematic/build';
import { DEFAULT_LAYOUT_CONFIG, layout } from '../src/core/layout/index';
import type { SongModel } from '../src/core/midi/types';
import { DEFAULT_REGIONS } from '../src/core/palette/pitchMap';
import { TagType } from '../src/core/nbt/tag';

function song(tracks: Array<{
  index: number;
  instrument: string;
  notes: Array<{ tick: number; midi: number }>;
}>): SongModel {
  return {
    name: 'regression',
    ppq: 480,
    durationSec: 2,
    baseBpm: 120,
    tempos: [{ ticks: 0, timeSec: 0, bpm: 120 }],
    timeSignature: null,
    tracks: tracks.map((t) => ({
      index: t.index,
      name: `track-${t.index}`,
      channel: t.index,
      instrument: t.instrument,
      percussion: false,
      notes: t.notes.map((n) => ({
        midi: n.midi,
        timeSec: n.tick / DEFAULT_LAYOUT_CONFIG.baseTps,
        durationSec: 0.1,
        velocity: 1,
        channel: t.index,
      })),
    })),
  };
}

describe('回归：布局参数与合轨空间', () => {
  it('outOfRange=drop 从布局入口生效', () => {
    const result = layout(
      song([
        {
          index: 0,
          instrument: 'Piano',
          notes: [
            { tick: 0, midi: 10 },
            { tick: 10, midi: 60 },
          ],
        },
      ]),
      { regions: DEFAULT_REGIONS, outOfRange: 'drop' },
    );

    const noteBlocks = result.tracks.reduce(
      (count, track) =>
        count + track.placements.filter((p) => p.block === 'minecraft:note_block').length,
      0,
    );
    expect(noteBlocks).toBe(1);
    expect(result.warnings).toContainEqual({
      code: 'OUT_OF_RANGE',
      midi: 10,
      action: 'drop',
    });
  });

  it('dMax 限制单轨和弦容量', () => {
    const result = layout(
      song([
        {
          index: 0,
          instrument: 'Piano',
          notes: Array.from({ length: 7 }, (_, i) => ({ tick: 0, midi: 54 + i })),
        },
      ]),
      { config: { dMax: 2 }, regions: DEFAULT_REGIONS },
    );

    expect(result.tracks).toHaveLength(2);
    expect(result.warnings).toContainEqual({
      code: 'POLYPHONY_EXCEEDED',
      tick: 0,
      n: 7,
      limit: 5,
    });
    const noteBlocks = result.tracks.reduce(
      (count, track) =>
        count + track.placements.filter((p) => p.block === 'minecraft:note_block').length,
      0,
    );
    expect(noteBlocks).toBe(7);
  });

  it('合轨后按合并后的最大和弦深度计算轨距，不发生 Z 重叠', () => {
    const result = layout(
      song([
        {
          index: 0,
          instrument: 'Piano',
          notes: Array.from({ length: 5 }, (_, i) => ({ tick: 0, midi: 54 + i })),
        },
        {
          index: 1,
          instrument: 'Piano',
          notes: Array.from({ length: 5 }, (_, i) => ({ tick: 0, midi: 60 + i })),
        },
        { index: 2, instrument: 'Violin', notes: [{ tick: 0, midi: 67 }] },
      ]),
      { mergeSameInstrument: true, regions: DEFAULT_REGIONS },
    );

    expect(result.tracks).toHaveLength(2);
    const ranges = result.tracks.map((track) => {
      const zs = track.placements.map((p) => p.pos.z);
      return [Math.min(...zs), Math.max(...zs)] as const;
    });
    expect(Math.min(ranges[0]![1], ranges[1]![1]) - Math.max(ranges[0]![0], ranges[1]![0])).toBeLessThanOrEqual(0);
  });
});

describe('回归：Litematic 元数据', () => {
  it('EnclosingSize 使用区域包围盒，TotalBlocks 不统计 air', () => {
    const raw = buildLitematic(
      [
        {
          position: { x: 0, y: 0, z: 0 },
          size: { x: 2, y: 1, z: 1 },
          blocks: [{ x: 0, y: 0, z: 0, state: { name: 'minecraft:stone' } }],
        },
        {
          position: { x: 0, y: 0, z: 10 },
          size: { x: 2, y: 1, z: 1 },
          blocks: [{ x: 0, y: 0, z: 0, state: { name: 'minecraft:air' } }],
        },
      ],
      { name: 'x', author: 'a', description: '', dataVersion: 3700, version: 6 },
    );
    const root = readNbt(gunzipSync(raw)).tag;
    expect(root.type).toBe(TagType.Compound);
    if (root.type !== TagType.Compound) return;
    const metadata = root.value.get('Metadata');
    expect(metadata?.type).toBe(TagType.Compound);
    if (!metadata || metadata.type !== TagType.Compound) return;

    const totalBlocks = metadata.value.get('TotalBlocks');
    const enclosing = metadata.value.get('EnclosingSize');
    expect(totalBlocks?.type).toBe(TagType.Int);
    expect(totalBlocks && totalBlocks.type === TagType.Int ? totalBlocks.value : -1).toBe(1);
    expect(enclosing?.type).toBe(TagType.Compound);
    if (!enclosing || enclosing.type !== TagType.Compound) return;
    expect((enclosing.value.get('x') as { value: number }).value).toBe(2);
    expect((enclosing.value.get('y') as { value: number }).value).toBe(1);
    expect((enclosing.value.get('z') as { value: number }).value).toBe(11);
  });
});
