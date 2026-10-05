import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseMidi } from '../src/core/midi/parse';
import { formatDuration, speedTable } from '../src/core/tempo/speed';
import { MAX_QUANTIZE_ERROR_MS, secondsToTick } from '../src/core/tempo/tick';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const file = arg('midi');
if (!file) {
  console.error('用法: npm run cli -- --midi <file.mid>');
  process.exit(1);
}

const song = parseMidi(readFileSync(file));

console.log(`文件: ${basename(file)}`);
console.log(`曲名: ${song.name || '(无)'}`);
console.log(`PPQ: ${song.ppq}  时长: ${formatDuration(song.durationSec)}`);
console.log(`拍号: ${song.timeSignature ? song.timeSignature.join('/') : '(无)'}`);
console.log(`基准 BPM: ${song.baseBpm}`);
console.log(`量化误差上限: ±${MAX_QUANTIZE_ERROR_MS}ms`);
console.log(`音轨数: ${song.tracks.length}`);

console.log('\n== tempo 段 ==');
for (const t of song.tempos) {
  console.log(`  ticks=${t.ticks}  t=${t.timeSec.toFixed(3)}s  bpm=${t.bpm.toFixed(2)}`);
}

console.log('\n== 音轨与音符事件 ==');
for (const tr of song.tracks) {
  console.log(
    `\n[轨 ${tr.index}] ${tr.name || '(无名)'}  乐器=${tr.instrument}  ch=${tr.channel}${tr.percussion ? ' (打击乐)' : ''}  音符数=${tr.notes.length}`,
  );
  for (const n of tr.notes) {
    const tick = secondsToTick(n.timeSec);
    console.log(
      `  tick=${String(tick).padStart(6)}  midi=${String(n.midi).padStart(3)}  t=${n.timeSec.toFixed(3)}s  dur=${n.durationSec.toFixed(3)}s  vel=${n.velocity.toFixed(2)}`,
    );
  }
}

console.log('\n== 变速换算表 ==');
console.log('  倍率   tick rate   实际时长');
for (const row of speedTable(song.durationSec, [1.0, 0.75, 0.5, 1.5, 2.0])) {
  console.log(
    `  ${row.factor.toFixed(2).padStart(4)}×  ${String(row.tickRate).padStart(8)}   ${formatDuration(row.durationSec)}`,
  );
}
