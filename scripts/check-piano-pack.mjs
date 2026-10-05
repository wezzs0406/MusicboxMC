import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EXPECTED_SOUNDS = {
  'block.note_block.bass': 'note/harp1',
  'block.note_block.guitar': 'note/harp2',
  'block.note_block.harp': 'note/harp3',
  'block.note_block.flute': 'note/harp4',
  'block.note_block.bell': 'note/harp5',
};

const REQUIRED_FILES = [
  'pack.mcmeta',
  'assets/minecraft/sounds.json',
  ...Object.values(EXPECTED_SOUNDS).map((name) => `assets/minecraft/sounds/${name}.ogg`),
];

function usage() {
  console.error('用法：node scripts/check-piano-pack.mjs <resource-pack.zip>');
  process.exit(2);
}

function readZipEntries(buffer) {
  const eocd = findSignature(
    buffer,
    0x06054b50,
    buffer.length - 22,
    Math.max(0, buffer.length - 0x10000 - 22),
  );
  if (eocd < 0) throw new Error('不是可识别的 ZIP 文件（缺少 EOCD）');

  const count = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let cursor = directoryOffset;

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString('utf8')
      .replaceAll('\\', '/');
    cursor += 46 + nameLength + extraLength + commentLength;

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP 条目损坏：${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`不支持的 ZIP 压缩方式 ${method}：${name}`);
    if (data.length !== uncompressedSize) throw new Error(`ZIP 条目大小校验失败：${name}`);
    entries.set(name, data);
  }
  return entries;
}

function findSignature(buffer, signature, start, min = 0) {
  for (let i = Math.min(start, buffer.length - 4); i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === signature) return i;
  }
  return -1;
}

function readJson(entries, name) {
  const data = entries.get(name);
  if (!data) throw new Error(`缺少 ${name}`);
  try {
    return JSON.parse(data.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`${name} 不是合法 JSON：${error.message}`);
  }
}

function soundName(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  const sounds = value.sounds;
  if (!Array.isArray(sounds) || sounds.length === 0) return null;
  const first = sounds[0];
  return typeof first === 'string' ? first : first?.name ?? null;
}

const input = process.argv[2];
if (!input) usage();

const file = resolve(input);
const entries = readZipEntries(readFileSync(file));
const missing = REQUIRED_FILES.filter((name) => !entries.has(name));
const mcmeta = readJson(entries, 'pack.mcmeta');
const sounds = readJson(entries, 'assets/minecraft/sounds.json');
const mappings = Object.fromEntries(
  Object.entries(EXPECTED_SOUNDS).map(([event, expected]) => {
    const actual = soundName(sounds[event]);
    return [event, { expected, actual, ok: actual === expected && sounds[event]?.replace === true }];
  }),
);
const sampleFiles = [...entries.keys()]
  .filter((name) => name.startsWith('assets/minecraft/sounds/') && name.endsWith('.ogg'))
  .sort();
const packFormat = mcmeta?.pack?.pack_format;
const supportedFormats = mcmeta?.pack?.supported_formats;
const packFormatIsInteger = Number.isInteger(packFormat);
const supportedFormatsAreIntegers =
  supportedFormats === undefined ||
  (Array.isArray(supportedFormats) && supportedFormats.every((value) => Number.isInteger(value)));

const report = {
  file,
  entryCount: entries.size,
  packFormat,
  projectTarget: { minecraft: '1.20.4', resourcePackFormat: 22 },
  versionCompatibleWithProject: packFormat === 22,
  packFormatIsInteger,
  supportedFormatsAreIntegers,
  metadataWarnings: [
    ...(packFormatIsInteger ? [] : ['pack.pack_format 不是整数；26.2 源码的 PackFormat codec 不接受小数']),
    ...(supportedFormatsAreIntegers
      ? []
      : ['pack.supported_formats 含非整数；请按目标版本的 pack.mcmeta schema 修正']),
  ],
  missing,
  samples: sampleFiles,
  mappings,
  complete:
    missing.length === 0 &&
    Object.values(mappings).every((item) => item.ok) &&
    packFormatIsInteger &&
    supportedFormatsAreIntegers,
};

console.log(JSON.stringify(report, null, 2));
if (!report.complete) process.exitCode = 1;
