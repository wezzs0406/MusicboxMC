import { NbtCompound, NbtList, NbtTag, TagType, nbt } from './tag';

/** 大端序 NBT 读取器，用于自研回读校验。 */
class NbtReader {
  private pos = 0;

  constructor(private readonly buf: Buffer) {}

  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new Error(`NBT 越界读取: pos=${this.pos} need=${n} len=${this.buf.length}`);
    }
  }

  u8(): number {
    this.need(1);
    return this.buf.readUInt8(this.pos++);
  }

  i8(): number {
    this.need(1);
    return this.buf.readInt8(this.pos++);
  }

  i16(): number {
    this.need(2);
    const v = this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return v;
  }

  u16(): number {
    this.need(2);
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  i64(): bigint {
    this.need(8);
    const v = this.buf.readBigInt64BE(this.pos);
    this.pos += 8;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.buf.readFloatBE(this.pos);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.buf.readDoubleBE(this.pos);
    this.pos += 8;
    return v;
  }

  str(): string {
    const len = this.u16();
    this.need(len);
    const s = this.buf.toString('utf8', this.pos, this.pos + len);
    this.pos += len;
    return s;
  }

  private payload(type: TagType): NbtTag {
    switch (type) {
      case TagType.Byte:
        return nbt.byte(this.i8());
      case TagType.Short:
        return nbt.short(this.i16());
      case TagType.Int:
        return nbt.int(this.i32());
      case TagType.Long:
        return nbt.long(this.i64());
      case TagType.Float:
        return nbt.float(this.f32());
      case TagType.Double:
        return nbt.double(this.f64());
      case TagType.String:
        return nbt.string(this.str());
      case TagType.ByteArray: {
        const len = this.i32();
        const arr = new Int8Array(len);
        for (let i = 0; i < len; i++) arr[i] = this.i8();
        return { type: TagType.ByteArray, value: arr };
      }
      case TagType.IntArray: {
        const len = this.i32();
        const arr = new Int32Array(len);
        for (let i = 0; i < len; i++) arr[i] = this.i32();
        return { type: TagType.IntArray, value: arr };
      }
      case TagType.LongArray: {
        const len = this.i32();
        const arr: bigint[] = new Array(len);
        for (let i = 0; i < len; i++) arr[i] = this.i64();
        return { type: TagType.LongArray, value: arr };
      }
      case TagType.List: {
        const elementType = this.u8() as TagType;
        const len = this.i32();
        const items: NbtTag[] = [];
        for (let i = 0; i < len; i++) items.push(this.payload(elementType));
        return { type: TagType.List, elementType, value: items } satisfies NbtList;
      }
      case TagType.Compound: {
        const map = new Map<string, NbtTag>();
        for (;;) {
          const childType = this.u8() as TagType;
          if (childType === TagType.End) break;
          const name = this.str();
          map.set(name, this.payload(childType));
        }
        return { type: TagType.Compound, value: map } satisfies NbtCompound;
      }
      case TagType.End:
        throw new Error('无法读取 End 标签的负载');
      default:
        throw new Error(`未知标签类型 ${type}`);
    }
  }

  readRoot(): { name: string; tag: NbtTag } {
    const type = this.u8() as TagType;
    const name = this.str();
    return { name, tag: this.payload(type) };
  }
}

export function readNbt(buf: Buffer): { name: string; tag: NbtTag } {
  return new NbtReader(buf).readRoot();
}
