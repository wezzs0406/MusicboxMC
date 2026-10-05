import { describe, expect, it } from 'vitest';
import {
  AIR,
  createBlockResolver,
  DEFAULT_BLOCK_TABLE,
  isAir,
  type BlockTable,
} from '../src/core/palette/blockTable';

const base = { global: DEFAULT_BLOCK_TABLE };

describe('blockTable 选方块解析层', () => {
  it('无覆盖时回落到全局默认', () => {
    const r = createBlockResolver(base);
    expect(r({ slot: 'wireSupport' })).toBe(DEFAULT_BLOCK_TABLE.wireSupport);
    expect(r({ slot: 'noteBase' })).toBe(DEFAULT_BLOCK_TABLE.noteBase);
    expect(r({ slot: 'floor' })).toBe(DEFAULT_BLOCK_TABLE.floor);
  });

  it('默认值本身可按音区给（垫底方块本来就分音区）', () => {
    const r = createBlockResolver({
      global: DEFAULT_BLOCK_TABLE,
      regions: { A: { noteBase: 'minecraft:dirt' }, C: { noteBase: 'minecraft:bedrock' } },
    });
    expect(r({ slot: 'noteBase', region: 'A' })).toBe('minecraft:dirt');
    expect(r({ slot: 'noteBase', region: 'C' })).toBe('minecraft:bedrock');
    // 没给音区默认的仍回落全局
    expect(r({ slot: 'noteBase', region: 'B' })).toBe(DEFAULT_BLOCK_TABLE.noteBase);
  });

  it('音轨级覆盖生效，且不影响其它音轨', () => {
    const r = createBlockResolver(base, {
      tracks: { 0: { wireSupport: 'minecraft:stone' } },
    });
    expect(r({ slot: 'wireSupport', trackIndex: 0 })).toBe('minecraft:stone');
    expect(r({ slot: 'wireSupport', trackIndex: 1 })).toBe(DEFAULT_BLOCK_TABLE.wireSupport);
    expect(r({ slot: 'wireSupport' })).toBe(DEFAULT_BLOCK_TABLE.wireSupport);
  });

  it('覆盖优先于默认，且音区覆盖 > 音轨覆盖', () => {
    const r = createBlockResolver(
      { global: DEFAULT_BLOCK_TABLE, regions: { A: { noteBase: 'minecraft:dirt' } } },
      {
        tracks: { 0: { noteBase: 'minecraft:stone' } },
        regions: { A: { noteBase: 'minecraft:obsidian' } },
      },
    );
    // 音区覆盖赢过音轨覆盖
    expect(r({ slot: 'noteBase', trackIndex: 0, region: 'A' })).toBe('minecraft:obsidian');
    // 音区没覆盖的槽位走音轨覆盖
    expect(r({ slot: 'wireSupport', trackIndex: 0, region: 'A' })).toBe(
      DEFAULT_BLOCK_TABLE.wireSupport,
    );
    // 音区覆盖赢过音区默认
    expect(r({ slot: 'noteBase', region: 'A' })).toBe('minecraft:obsidian');
  });

  it('允许把任意位置解析成空气', () => {
    const r = createBlockResolver(base, { regions: { C: { wireSupport: AIR } } });
    const got = r({ slot: 'wireSupport', region: 'C' });
    expect(got).toBe(AIR);
    expect(isAir(got)).toBe(true);
  });

  it('覆盖表不必写全，缺的槽位逐级回落', () => {
    const partial: Partial<BlockTable> = { floor: 'minecraft:bedrock' };
    const r = createBlockResolver(base, { tracks: { 2: partial } });
    expect(r({ slot: 'floor', trackIndex: 2 })).toBe('minecraft:bedrock');
    expect(r({ slot: 'noteBase', trackIndex: 2 })).toBe(DEFAULT_BLOCK_TABLE.noteBase);
  });

  it('isAir 只认 minecraft:air', () => {
    expect(isAir(AIR)).toBe(true);
    expect(isAir('minecraft:dirt')).toBe(false);
  });
});
