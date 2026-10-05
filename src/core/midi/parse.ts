import { Midi } from '@tonejs/midi';
import type { NoteEvent, SongModel, TempoSegment, TrackModel } from './types';

/** 解析 MIDI 二进制为归一化的 SongModel。 */
export function parseMidi(buffer: Buffer | Uint8Array): SongModel {
  const midi = new Midi(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));

  const tempos: TempoSegment[] = midi.header.tempos.map((t) => ({
    ticks: t.ticks,
    timeSec: t.time ?? 0,
    bpm: t.bpm,
  }));
  if (tempos.length === 0) {
    tempos.push({ ticks: 0, timeSec: 0, bpm: 120 });
  }

  const ts = midi.header.timeSignatures[0];
  const timeSignature: [number, number] | null = ts
    ? [ts.timeSignature[0]!, ts.timeSignature[1]!]
    : null;

  const tracks: TrackModel[] = midi.tracks.map((track, index) => {
    const notes: NoteEvent[] = track.notes.map((n) => ({
      midi: n.midi,
      timeSec: n.time,
      durationSec: n.duration,
      velocity: n.velocity,
      channel: track.channel,
    }));
    notes.sort((a, b) => a.timeSec - b.timeSec || a.midi - b.midi);
    return {
      index,
      name: track.name,
      channel: track.channel,
      instrument: track.instrument?.name ?? 'unknown',
      percussion: track.instrument?.percussion ?? false,
      notes,
    };
  });

  return {
    name: midi.name || '',
    ppq: midi.header.ppq,
    durationSec: midi.duration,
    baseBpm: tempos[0]!.bpm,
    tempos,
    timeSignature,
    tracks,
  };
}
