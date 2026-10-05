/** NBT 标签类型 id（与 Minecraft 协议一致）。 */
export enum TagType {
  End = 0,
  Byte = 1,
  Short = 2,
  Int = 3,
  Long = 4,
  Float = 5,
  Double = 6,
  ByteArray = 7,
  String = 8,
  List = 9,
  Compound = 10,
  IntArray = 11,
  LongArray = 12,
}

export interface NbtByte {
  type: TagType.Byte;
  value: number;
}
export interface NbtShort {
  type: TagType.Short;
  value: number;
}
export interface NbtInt {
  type: TagType.Int;
  value: number;
}
export interface NbtLong {
  type: TagType.Long;
  value: bigint;
}
export interface NbtFloat {
  type: TagType.Float;
  value: number;
}
export interface NbtDouble {
  type: TagType.Double;
  value: number;
}
export interface NbtString {
  type: TagType.String;
  value: string;
}
export interface NbtByteArray {
  type: TagType.ByteArray;
  value: Int8Array;
}
export interface NbtIntArray {
  type: TagType.IntArray;
  value: Int32Array;
}
export interface NbtLongArray {
  type: TagType.LongArray;
  value: bigint[];
}
export interface NbtList {
  type: TagType.List;
  /** 元素类型；空列表默认 End */
  elementType: TagType;
  value: NbtTag[];
}
export interface NbtCompound {
  type: TagType.Compound;
  /** 保持插入顺序 */
  value: Map<string, NbtTag>;
}

export type NbtTag =
  | NbtByte
  | NbtShort
  | NbtInt
  | NbtLong
  | NbtFloat
  | NbtDouble
  | NbtString
  | NbtByteArray
  | NbtIntArray
  | NbtLongArray
  | NbtList
  | NbtCompound;

// ---- 构造器（保持调用点简洁） ----

export const nbt = {
  byte: (value: number): NbtByte => ({ type: TagType.Byte, value }),
  short: (value: number): NbtShort => ({ type: TagType.Short, value }),
  int: (value: number): NbtInt => ({ type: TagType.Int, value }),
  long: (value: bigint | number): NbtLong => ({
    type: TagType.Long,
    value: typeof value === 'bigint' ? value : BigInt(value),
  }),
  float: (value: number): NbtFloat => ({ type: TagType.Float, value }),
  double: (value: number): NbtDouble => ({ type: TagType.Double, value }),
  string: (value: string): NbtString => ({ type: TagType.String, value }),
  byteArray: (value: Int8Array | number[]): NbtByteArray => ({
    type: TagType.ByteArray,
    value: value instanceof Int8Array ? value : Int8Array.from(value),
  }),
  intArray: (value: Int32Array | number[]): NbtIntArray => ({
    type: TagType.IntArray,
    value: value instanceof Int32Array ? value : Int32Array.from(value),
  }),
  longArray: (value: bigint[]): NbtLongArray => ({ type: TagType.LongArray, value }),
  list: (elementType: TagType, value: NbtTag[]): NbtList => ({
    type: TagType.List,
    elementType: value.length > 0 ? value[0]!.type : elementType,
    value,
  }),
  compound: (entries: Record<string, NbtTag> | Map<string, NbtTag> = {}): NbtCompound => ({
    type: TagType.Compound,
    value: entries instanceof Map ? entries : new Map(Object.entries(entries)),
  }),
};

/** 纯整数的 XYZ 复合标签（Litematica 的 Position/Size/EnclosingSize 都用它）。 */
export function nbtIntVec3(x: number, y: number, z: number): NbtCompound {
  return nbt.compound({
    x: nbt.int(x),
    y: nbt.int(y),
    z: nbt.int(z),
  });
}
