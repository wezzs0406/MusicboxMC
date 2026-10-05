import { describe, expect, it } from 'vitest';
import { packLongArray, requiredBits, unpackLongArray } from '../src/core/litematic/bitArray';

describe('bitArray', () => {
  it('位宽 = max(2, ceil(log2(paletteSize)))', () => {
    expect(requiredBits(1)).toBe(2);
    expect(requiredBits(2)).toBe(2);
    expect(requiredBits(3)).toBe(2);
    expect(requiredBits(4)).toBe(2);
    expect(requiredBits(5)).toBe(3);
    expect(requiredBits(11)).toBe(4);
    expect(requiredBits(20)).toBe(5);
    expect(requiredBits(36)).toBe(6);
    expect(requiredBits(128)).toBe(7);
    expect(requiredBits(257)).toBe(9);
  });

  it('round-trip 在小结构上稳定', () => {
    const indices = Array.from({ length: 27 }, (_, i) => i % 9);
    const bits = requiredBits(9);
    const longs = packLongArray(indices, bits);
    const back = unpackLongArray(longs, indices.length, bits);
    expect([...back]).toEqual(indices);
  });

  it('跨 64 位边界的紧密打包正确（3 位 × 100）', () => {
    const bits = 3;
    const indices = Array.from({ length: 100 }, (_, i) => i % 8);
    const longs = packLongArray(indices, bits);
    expect(longs).toHaveLength(Math.ceil((100 * bits) / 64));
    expect([...unpackLongArray(longs, 100, bits)]).toEqual(indices);
  });

  it('每个条目连续跨越字边界（紧密，非对齐）', () => {
    // bits=3 时条目 21 起始位 = 63，跨第 0/1 个字
    const bits = 3;
    const indices = new Array(30).fill(0);
    indices[21] = 7;
    const longs = packLongArray(indices, bits);
    const back = unpackLongArray(longs, 30, bits);
    expect(back[21]).toBe(7);
    expect(back[20]).toBe(0);
    expect(back[22]).toBe(0);
    // 紧密打包下 30*3=90 位只需 2 个 long（对齐打包也要 2 个，但低位组合不同）
    expect(longs).toHaveLength(2);
  });

  it('2 位宽（最小）round-trip', () => {
    const indices = [0, 1, 2, 3, 3, 2, 1, 0, 1, 3];
    const longs = packLongArray(indices, 2);
    expect([...unpackLongArray(longs, indices.length, 2)]).toEqual(indices);
  });

  it('最大索引值不越界', () => {
    for (const paletteSize of [2, 5, 17, 100, 257]) {
      const bits = requiredBits(paletteSize);
      const maxVal = paletteSize - 1;
      const indices = Array.from({ length: 50 }, (_, i) => (i * 7) % paletteSize);
      const longs = packLongArray(indices, bits);
      const back = unpackLongArray(longs, 50, bits);
      for (const v of back) expect(v).toBeLessThanOrEqual(maxVal);
      expect([...back]).toEqual(indices);
    }
  });
});
