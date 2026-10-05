/** 音符盒方块状态序列化。 */

import type { NoteBlockInstrument } from './pitchMap';

export interface BlockState {
  /** 完整方块 id，如 minecraft:note_block */
  name: string;
  /** 方块状态属性，值均为字符串 */
  properties?: Record<string, string>;
}

export const AIR: BlockState = { name: 'minecraft:air' };

/** 音符盒：note 档位 0-24，并显式写入 instrument，避免粘贴后回落到 harp。 */
export function noteBlock(note: number, instrument: NoteBlockInstrument = 'harp'): BlockState {
  return {
    name: 'minecraft:note_block',
    properties: { instrument, note: String(clampNote(note)), powered: 'false' },
  };
}

/** 红石线：power 0-15。 */
export function redstoneWire(power = 0): BlockState {
  return {
    name: 'minecraft:redstone_wire',
    properties: { power: String(Math.max(0, Math.min(15, power))) },
  };
}

export type RepeaterFacing = 'north' | 'south' | 'east' | 'west';

/** 红石中继器：delay 1-4，facing 为输出方向。 */
export function repeater(facing: RepeaterFacing, delay: number): BlockState {
  return {
    name: 'minecraft:repeater',
    properties: {
      facing,
      delay: String(clampDelay(delay)),
      locked: 'false',
      powered: 'false',
    },
  };
}

/** 无属性的普通方块（垫底方块等）。 */
export function plainBlock(name: string): BlockState {
  return { name };
}

function clampNote(n: number): number {
  return Math.max(0, Math.min(24, Math.round(n)));
}

function clampDelay(d: number): number {
  return Math.max(1, Math.min(4, Math.round(d)));
}

/** 稳定的调色板键，用于去重。 */
export function stateKey(s: BlockState): string {
  if (!s.properties) return s.name;
  const keys = Object.keys(s.properties).sort();
  return `${s.name}[${keys.map((k) => `${k}=${s.properties![k]}`).join(',')}]`;
}
