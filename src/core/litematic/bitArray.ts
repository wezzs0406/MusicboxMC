/**
 * Litematica 的 BlockStates 紧密位打包。
 *
 * 与 Minecraft 原版 BitArray 不同，Litematica 的条目**连续跨越 64 位边界**，
 * 不做每字对齐。写入按小端位序（最低位在前）。
 *
 *   bits   = max(2, ceil(log2(paletteSize)))
 *   length = ceil(volume * bits / 64)
 *   条目 i 起始位 start = i * bits
 *   字索引 startArrIndex = start >>> 6
 *   跨字     endArrIndex = (start + bits - 1) >>> 6
 */

/** 由调色板大小求每个条目的位宽（最小 2 位）。 */
export function requiredBits(paletteSize: number): number {
  return Math.max(2, bitLength(paletteSize - 1));
}

function bitLength(n: number): number {
  let bits = 0;
  let v = n;
  while (v > 0) {
    bits++;
    v = Math.floor(v / 2);
  }
  return bits;
}

/** 长整型数组长度。 */
export function longArrayLength(volume: number, bits: number): number {
  return Math.ceil((volume * bits) / 64);
}

const MASK64 = (1n << 64n) - 1n;

/** 将索引数组（每个元素 < 2^bits）打包为 long 数组。 */
export function packLongArray(indices: ArrayLike<number>, bits: number): bigint[] {
  const volume = indices.length;
  const longs = new Array<bigint>(longArrayLength(volume, bits)).fill(0n);
  const mask = (1n << BigInt(bits)) - 1n;

  for (let i = 0; i < volume; i++) {
    const value = BigInt(indices[i]!) & mask;
    const start = i * bits;
    const startWord = start >>> 6;
    const startOffset = start & 63;
    const endWord = (start + bits - 1) >>> 6;

    longs[startWord] = (longs[startWord]! | ((value << BigInt(startOffset)) & MASK64)) & MASK64;

    const remaining = bits - (64 - startOffset);
    if (remaining > 0) {
      longs[endWord] = (longs[endWord]! | (value >> BigInt(64 - startOffset))) & MASK64;
    }
  }

  return longs;
}

/** 从 long 数组解包出索引数组。 */
export function unpackLongArray(
  longs: bigint[],
  volume: number,
  bits: number,
): Uint32Array {
  const out = new Uint32Array(volume);
  const mask = (1n << BigInt(bits)) - 1n;

  for (let i = 0; i < volume; i++) {
    const start = i * bits;
    const startWord = start >>> 6;
    const startOffset = start & 63;
    const endWord = (start + bits - 1) >>> 6;

    let value = longs[startWord]! >> BigInt(startOffset);
    if (endWord !== startWord) {
      value |= longs[endWord]! << BigInt(64 - startOffset);
    }
    out[i] = Number(value & mask);
  }

  return out;
}
