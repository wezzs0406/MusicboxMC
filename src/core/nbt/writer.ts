import { NbtTag, TagType } from './tag';

/** 大端序 NBT 序列化器（NBT 规范要求所有基本类型大端序）。 */
class NbtWriter {
  private buf: Buffer;
  private pos = 0;

  constructor(initial = 1024) {
    this.buf = Buffer.alloc(initial);
  }

  private ensure(extra: number): void {
    if (this.pos + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + extra) size *= 2;
    const next = Buffer.alloc(size);
    this.buf.copy(next, 0, 0, this.pos);
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf.writeUInt8(v & 0xff, this.pos);
    this.pos += 1;
  }

  i8(v: number): void {
    this.ensure(1);
    this.buf.writeInt8(v, this.pos);
    this.pos += 1;
  }

  i16(v: number): void {
    this.ensure(2);
    this.buf.writeInt16BE(v, this.pos);
    this.pos += 2;
  }

  u16(v: number): void {
    this.ensure(2);
    this.buf.writeUInt16BE(v, this.pos);
    this.pos += 2;
  }

  i32(v: number): void {
    this.ensure(4);
    this.buf.writeInt32BE(v, this.pos);
    this.pos += 4;
  }

  i64(v: bigint): void {
    this.ensure(8);
    this.buf.writeBigInt64BE(BigInt.asIntN(64, v), this.pos);
    this.pos += 8;
  }

  f32(v: number): void {
    this.ensure(4);
    this.buf.writeFloatBE(v, this.pos);
    this.pos += 4;
  }

  f64(v: number): void {
    this.ensure(8);
    this.buf.writeDoubleBE(v, this.pos);
    this.pos += 8;
  }

  /** 无符号 16 位长度的 UTF-8 字符串 */
  str(s: string): void {
    const bytes = Buffer.from(s, 'utf8');
    if (bytes.length > 0xffff) {
      throw new Error(`NBT 字符串过长：${bytes.length} bytes`);
    }
    this.u16(bytes.length);
    this.ensure(bytes.length);
    bytes.copy(this.buf, this.pos);
    this.pos += bytes.length;
  }

  raw(bytes: Buffer | Uint8Array): void {
    this.ensure(bytes.length);
    Buffer.from(bytes).copy(this.buf, this.pos);
    this.pos += bytes.length;
  }

  private payload(tag: NbtTag): void {
    switch (tag.type) {
      case TagType.Byte:
        this.i8(tag.value);
        break;
      case TagType.Short:
        this.i16(tag.value);
        break;
      case TagType.Int:
        this.i32(tag.value);
        break;
      case TagType.Long:
        this.i64(tag.value);
        break;
      case TagType.Float:
        this.f32(tag.value);
        break;
      case TagType.Double:
        this.f64(tag.value);
        break;
      case TagType.String:
        this.str(tag.value);
        break;
      case TagType.ByteArray:
        this.i32(tag.value.length);
        for (let i = 0; i < tag.value.length; i++) this.i8(tag.value[i]!);
        break;
      case TagType.IntArray:
        this.i32(tag.value.length);
        for (let i = 0; i < tag.value.length; i++) this.i32(tag.value[i]!);
        break;
      case TagType.LongArray:
        this.i32(tag.value.length);
        for (const v of tag.value) this.i64(v);
        break;
      case TagType.List:
        this.u8(tag.elementType);
        this.i32(tag.value.length);
        for (const item of tag.value) this.payload(item);
        break;
      case TagType.Compound:
        for (const [name, child] of tag.value) {
          this.u8(child.type);
          this.str(name);
          this.payload(child);
        }
        this.u8(TagType.End);
        break;
    }
  }

  /** 写带名字的标签，返回字节。 */
  write(name: string, tag: NbtTag): Buffer {
    this.u8(tag.type);
    this.str(name);
    this.payload(tag);
    return this.buf.subarray(0, this.pos);
  }
}

export function writeNbt(name: string, tag: NbtTag): Buffer {
  const bytes = new NbtWriter().write(name, tag);
  return Buffer.from(bytes);
}
