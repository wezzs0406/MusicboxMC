export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 归一化后的单个音符事件（时间已换算为秒，直接来自 MIDI）。 */
export interface NoteEvent {
  /** MIDI 音高 0-127 */
  midi: number;
  /** 起始时间（秒） */
  timeSec: number;
  /** 时值（秒） */
  durationSec: number;
  /** 力度 0-1 */
  velocity: number;
  /** MIDI 通道，9/10 为打击乐 */
  channel: number;
}

export interface TempoSegment {
  /** 该段起始 tick（以文件 PPQ 为单位） */
  ticks: number;
  /** 该段起始时间（秒） */
  timeSec: number;
  /** BPM */
  bpm: number;
}

export interface TrackModel {
  index: number;
  name: string;
  channel: number;
  instrument: string;
  percussion: boolean;
  notes: NoteEvent[];
}

export interface SongModel {
  name: string;
  /** 文件 PPQ（每四分音符的脉冲数） */
  ppq: number;
  /** 总时长（秒），到最后一个音符结束 */
  durationSec: number;
  /** 基准 BPM：取首个 tempo 事件（D-06） */
  baseBpm: number;
  tempos: TempoSegment[];
  timeSignature: [number, number] | null;
  tracks: TrackModel[];
}
