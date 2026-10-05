import type { BlockPlacement, LayoutResult } from './types';

export interface RegionSlice {
  /** 所属原始音轨 index；拆轨后的区域可以共享该 index */
  trackIndex: number;
  position: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  blocks: BlockPlacement[];
}

/**
 * 把布局结果切成 litematic 区域（文档 §6.1：大结构需分区域避免单个数组过大）。
 *
 * 当前实现：每条音轨一个区域。同一音轨的 z 范围是连续区间，不同音轨之间
 * 至少隔一个 trackPitch，因此天然不重叠。
 *
 * 关键点：region 内方块坐标必须 ≥0，而布局坐标可能为负（复音支线沿 -Z 展开），
 * 因此区域原点取该轨的实际最小值，并把方块坐标整体平移 (minX, minY, minZ)。
 */
export function sliceRegions(result: LayoutResult): RegionSlice[] {
  const slices: RegionSlice[] = [];

  for (const tr of result.tracks) {
    const all = [...tr.placements, ...tr.bridges];
    if (all.length === 0) continue;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const p of all) {
      minX = Math.min(minX, p.pos.x);
      maxX = Math.max(maxX, p.pos.x);
      minY = Math.min(minY, p.pos.y);
      maxY = Math.max(maxY, p.pos.y);
      minZ = Math.min(minZ, p.pos.z);
      maxZ = Math.max(maxZ, p.pos.z);
    }

    slices.push({
      trackIndex: tr.trackIndex,
      position: { x: minX, y: minY, z: minZ },
      size: { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 },
      blocks: all.map((p) => ({
        ...p,
        pos: { x: p.pos.x - minX, y: p.pos.y - minY, z: p.pos.z - minZ },
      })),
    });
  }

  return slices;
}
