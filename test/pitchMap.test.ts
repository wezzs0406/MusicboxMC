import { describe, expect, it } from 'vitest';
import { DEFAULT_REGIONS, mapPitch } from '../src/core/palette/pitchMap';

describe('钢琴全音域资源包音高映射', () => {
  it('覆盖 F#1 到 F#7（MIDI 30 到 102），并在采样中心使用 note=12', () => {
    const expected = [
      [30, 'A', 'bass', 0],
      [42, 'A', 'bass', 12],
      [54, 'B', 'guitar', 12],
      [66, 'C', 'harp', 12],
      [78, 'D', 'flute', 12],
      [102, 'E', 'bell', 24],
    ] as const;

    for (const [midi, region, instrument, note] of expected) {
      const mapped = mapPitch(midi, DEFAULT_REGIONS, 'drop');
      expect(mapped.dropped).toBe(false);
      expect(mapped.region).toBe(region);
      expect(mapped.instrument).toBe(instrument);
      expect(mapped.note).toBe(note);
    }
  });

  it('重叠音区优先使用距离采样中心最近的槽位', () => {
    expect(mapPitch(47).region).toBe('A');
    expect(mapPitch(48).region).toBe('B');
    expect(mapPitch(59).region).toBe('B');
    expect(mapPitch(60).region).toBe('C');
    expect(mapPitch(71).region).toBe('C');
    expect(mapPitch(72).region).toBe('D');
    expect(mapPitch(83).region).toBe('D');
    expect(mapPitch(84).region).toBe('E');
  });

  it('F#1 以下与 F#7 以上按策略处理', () => {
    expect(mapPitch(29, DEFAULT_REGIONS, 'drop').dropped).toBe(true);
    expect(mapPitch(103, DEFAULT_REGIONS, 'drop').dropped).toBe(true);

    const low = mapPitch(29, DEFAULT_REGIONS, 'clamp');
    expect(low.dropped).toBe(false);
    expect(low.region).toBe('A');
    expect(low.note).toBe(0);

    const high = mapPitch(103, DEFAULT_REGIONS, 'clamp');
    expect(high.dropped).toBe(false);
    expect(high.region).toBe('E');
    expect(high.note).toBe(24);
  });
});
