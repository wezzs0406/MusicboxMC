import { describe, expect, it } from 'vitest';
import {
  buildLitematic,
  blockIndex,
  LITEMATIC_VERSION_1_20_4,
  MC_1_20_4_DATA_VERSION,
  parseLitematic,
  type RegionData,
} from '../src/core/litematic/build';
import { writeNbt } from '../src/core/nbt/writer';
import { readNbt } from '../src/core/nbt/reader';
import { TagType, nbt } from '../src/core/nbt/tag';

describe('NBT writer/reader round-trip', () => {
  it('各标签类型可往返', () => {
    const root = nbt.compound({
      b: nbt.byte(-5),
      s: nbt.short(-300),
      i: nbt.int(-70000),
      l: nbt.long(1234567890123n),
      f: nbt.float(1.5),
      d: nbt.double(3.14159),
      str: nbt.string('hello 红石'),
      ba: nbt.byteArray([1, -2, 3]),
      ia: nbt.intArray([1, 2, -3]),
      la: nbt.longArray([1n, 2n, -3n]),
      list: nbt.list(TagType.Int, [nbt.int(1), nbt.int(2)]),
      nested: nbt.compound({ inner: nbt.string('x') }),
    });

    const bytes = writeNbt('root', root);
    const { name, tag } = readNbt(bytes);
    expect(name).toBe('root');
    expect(tag.type).toBe(TagType.Compound);

    const c = tag as typeof root;
    expect((c.value.get('b') as { value: number }).value).toBe(-5);
    expect((c.value.get('s') as { value: number }).value).toBe(-300);
    expect((c.value.get('i') as { value: number }).value).toBe(-70000);
    expect((c.value.get('l') as { value: bigint }).value).toBe(1234567890123n);
    expect((c.value.get('str') as { value: string }).value).toBe('hello 红石');
    expect([...(c.value.get('la') as { value: bigint[] }).value]).toEqual([1n, 2n, -3n]);
    expect((c.value.get('list') as { value: unknown[] }).value).toHaveLength(2);
  });
});

describe('litematic 组装与回读', () => {
  const region: RegionData = {
    position: { x: 0, y: 0, z: 0 },
    size: { x: 4, y: 3, z: 2 },
    blocks: [
      { x: 0, y: 2, z: 0, state: { name: 'minecraft:redstone_wire', properties: { power: '15' } } },
      {
        x: 0,
        y: 1,
        z: 0,
        state: {
          name: 'minecraft:note_block',
          properties: { instrument: 'harp', note: '12', powered: 'false' },
        },
      },
      { x: 0, y: 0, z: 0, state: { name: 'minecraft:grass_block' } },
      { x: 1, y: 2, z: 0, state: { name: 'minecraft:repeater', properties: { facing: 'east', delay: '4', locked: 'false', powered: 'false' } } },
    ],
  };

  it('生成的文件可回读，且 palette[0] 是 air', () => {
    const buf = buildLitematic([region], {
      name: 'Test',
      author: 'MusicboxMC',
      description: 'test',
      dataVersion: MC_1_20_4_DATA_VERSION,
      version: LITEMATIC_VERSION_1_20_4,
    });

    const parsed = parseLitematic(buf);
    expect(parsed.version).toBe(6);
    expect(parsed.dataVersion).toBe(3700);
    expect(parsed.metadata.name).toBe('Test');
    expect(parsed.regions).toHaveLength(1);

    const r = parsed.regions[0]!;
    expect(r.palette[0]!.name).toBe('minecraft:air');
  });

  it('方块坐标与状态在回读后一致', () => {
    const buf = buildLitematic([region], {
      name: 'T',
      author: 'A',
      description: '',
      dataVersion: 3700,
      version: 6,
    });
    const r = parseLitematic(buf).regions[0]!;

    const at = (x: number, y: number, z: number) =>
      r.palette[r.indices[blockIndex(x, y, z, r.size.x, r.size.z)]!]!;

    expect(at(0, 2, 0).name).toBe('minecraft:redstone_wire');
    expect(at(0, 2, 0).properties?.power).toBe('15');
    expect(at(0, 1, 0).name).toBe('minecraft:note_block');
    expect(at(0, 1, 0).properties?.instrument).toBe('harp');
    expect(at(0, 1, 0).properties?.note).toBe('12');
    expect(at(0, 0, 0).name).toBe('minecraft:grass_block');
    expect(at(1, 2, 0).properties?.delay).toBe('4');
    // 未放置处为 air
    expect(at(3, 0, 1).name).toBe('minecraft:air');
  });

  it('超出区域尺寸的方块坐标会报错', () => {
    expect(() =>
      buildLitematic(
        [{ ...region, blocks: [{ x: 99, y: 0, z: 0, state: { name: 'minecraft:stone' } }] }],
        { name: 'x', author: 'x', description: '', dataVersion: 3700, version: 6 },
      ),
    ).toThrow(/越界/);
  });
});
