'use strict';

/* 渲染进程：无框架，纯 DOM。所有重活都在主进程，这里只做展示与参数收集。 */

const api = window.musicbox;

const $ = (id) => document.getElementById(id);

const state = {
  analyze: null,
  generated: null,
  busy: false,
  previewScale: 1,
  previewRenderScale: 1,
};

/* ---------------- 日志 ---------------- */

const logLines = [];
function log(line) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  logLines.push(`[${ts}] ${line}`);
  if (logLines.length > 400) logLines.shift();
  $('log').textContent = logLines.join('\n');
}

/* ---------------- 通用 UI ---------------- */

/**
 * banner 是多个信息共用的单元素区域，直接赋值会互相覆盖
 * （曾把 F-12 "必须提示" 的资源包警告覆盖掉）。这里按优先级累积，
 * 并让更严重的级别决定整体配色。
 */
const BANNER_LEVEL = { ok: 0, warn: 1, err: 2 };
const bannerState = { level: null, lines: [] };

function banner(kind, text) {
  if (bannerState.level === null) {
    bannerState.level = kind;
    bannerState.lines = [];
  } else if (BANNER_LEVEL[kind] > BANNER_LEVEL[bannerState.level]) {
    bannerState.level = kind;
  }
  bannerState.lines.push(text);

  const el = $('banner');
  el.className = `banner ${bannerState.level}`;
  el.textContent = bannerState.lines.join('\n');
}

function resetBanner() {
  bannerState.level = null;
  bannerState.lines = [];
} 

function hideBanner() {
  resetBanner();
  $('banner').className = 'banner hidden';
}

function updateWorkflowUI(stage, res) {
  const steps = ['stepImport', 'stepSettings', 'stepPreview', 'stepExport'];
  const stepIndex = {
    waiting: 0,
    reading: 0,
    ready: 1,
    generating: 2,
    generated: 3,
    error: 0,
  }[stage] ?? 0;

  for (const [index, id] of steps.entries()) {
    const el = $(id);
    if (!el) continue;
    el.classList.toggle('done', index < stepIndex || stage === 'generated');
    el.classList.toggle('active', index === stepIndex && stage !== 'generated');
  }

  const workflowState = $('workflowState');
  const fileState = $('fileState');
  const controlState = $('controlState');
  const resultStatus = $('resultStatus');
  const workspaceTitle = $('workspaceTitle');
  const workspaceSubtitle = $('workspaceSubtitle');

  if (stage === 'waiting') {
    workflowState.textContent = '等待导入文件';
    fileState.textContent = '尚未选择文件';
    controlState.textContent = '等待解析';
    resultStatus.textContent = '等待解析';
    workspaceTitle.textContent = '还没有曲目';
    workspaceSubtitle.textContent = '选择 MIDI 文件后，这里会显示曲目结构和电路结果。';
    return;
  }

  if (stage === 'reading') {
    workflowState.textContent = '正在读取曲目';
    fileState.textContent = '正在解析…';
    controlState.textContent = '读取中';
    resultStatus.textContent = '读取中';
    return;
  }

  if (stage === 'generating') {
    workflowState.textContent = '正在生成预览';
    fileState.textContent = res?.file || '已选择文件';
    controlState.textContent = '参数已加载';
    resultStatus.textContent = '生成中';
    return;
  }

  if (stage === 'error') {
    workflowState.textContent = '需要处理';
    fileState.textContent = '文件读取失败';
    controlState.textContent = '请重试';
    resultStatus.textContent = '出现问题';
    return;
  }

  const file = res?.file || res?.song?.name || '已选择文件';
  const song = res?.song;
  const summary = song
    ? `${song.durationText} · ${song.trackCount} 条音轨 · ${song.noteCount} 个音符`
    : '可以继续调整参数';
  fileState.textContent = file;
  workspaceTitle.textContent = song?.name || file;
  workspaceSubtitle.textContent = summary;

  if (stage === 'generated') {
    workflowState.textContent = '投影已生成';
    controlState.textContent = '已完成';
    resultStatus.textContent = '已生成';
  } else {
    workflowState.textContent = '可以开始设置';
    controlState.textContent = '可以调整';
    resultStatus.textContent = '已读取';
  }
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function create(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function kv(pairs) {
  const dl = create('dl', 'kv');
  for (const [k, v] of pairs) {
    if (v === undefined || v === null || v === '') continue;
    dl.append(create('dt', null, k), create('dd', null, String(v)));
  }
  return dl;
}

function table(headers, rows) {
  const t = create('table');
  const thead = create('thead');
  const hr = create('tr');
  for (const h of headers) {
    hr.append(create('th', typeof h === 'object' && h.num ? 'num' : null, typeof h === 'object' ? h.label : h));
  }
  thead.append(hr);

  const tbody = create('tbody');
  for (const row of rows) {
    const tr = create('tr');
    for (const cell of row) {
      const numeric = typeof cell === 'number';
      tr.append(create('td', numeric ? 'num' : null, String(cell)));
    }
    tbody.append(tr);
  }
  t.append(thead, tbody);
  return t;
}

function card(title, ...children) {
  const c = create('div', 'card');
  if (title) c.append(create('h3', null, title));
  c.append(...children);
  return c;
}

/* ---------------- 参数收集 ---------------- */

function collectOptions() {
  const excluded = [];
  for (const cb of document.querySelectorAll('#trackList input[type=checkbox]')) {
    if (!cb.checked) excluded.push(Number(cb.dataset.index));
  }
  return {
    baseTps: Number($('baseTps').value) || 20,
    dMax: Number($('dMax').value) || 3,
    outOfRange: $('outOfRange').value,
    mergeSameInstrument: $('mergeSameInstrument').checked,
    excludeTracks: excluded,
    author: $('author').value || 'MusicboxMC',
  };
}

/* ---------------- 概览渲染 ---------------- */

function renderOverview(res) {
  const box = $('overview');
  box.className = '';
  box.replaceChildren();
  resetBanner();

  const s = res.song;
  const overviewHero = create('div', 'overview-hero');
  const heroCopy = create('div', 'overview-hero-copy');
  heroCopy.append(
    create('p', 'eyebrow', res.success ? 'GENERATED PROJECTION' : 'MIDI SUMMARY'),
    create('h3', null, s.name || res.file || '未命名曲目'),
    create(
      'p',
      null,
      res.success ? '投影已经生成，可以打开电路预览检查最终布局。' : '曲目已经读取，可以继续调整参数并生成投影。',
    ),
  );
  const metrics = create('div', 'overview-metrics');
  const metricPairs = [
    [s.durationText, '时长'],
    [s.baseBpm ? `${s.baseBpm}` : '—', 'BPM'],
    [s.noteCount, '音符'],
    [s.trackCount, '音轨'],
  ];
  for (const [value, labelText] of metricPairs) {
    const metric = create('div', 'overview-metric');
    metric.append(create('strong', null, String(value)), create('span', null, labelText));
    metrics.append(metric);
  }
  overviewHero.append(heroCopy, metrics);
  box.append(overviewHero);

  box.append(
    card(
      '曲目',
      kv([
        ['文件', res.file],
        ['曲名', s.name || '(无)'],
        ['PPQ', s.ppq],
        ['基准 BPM', s.baseBpm],
        ['拍号', s.timeSignature ? s.timeSignature.join('/') : '(无)'],
        ['时长', s.durationText],
        ['量化误差上限', `±${s.quantizeErrorMs}ms`],
        ['音轨 / 音符', `${s.trackCount} / ${s.noteCount}`],
      ]),
    ),
  );

  if (res.tracks.length > 0) {
    box.append(
      card(
        '音轨',
        table(
          ['#', '名称', '乐器', 'Ch', '音符', { label: 'tick 范围', num: true }],
          res.tracks.map((t) => [
            t.index,
            (t.name || '(无名)') + (t.percussion ? ' [打击乐]' : ''),
            t.instrument,
            t.channel,
            t.noteCount,
            t.noteCount > 0 ? `${t.minTick}–${t.maxTick}` : '—',
          ]),
        ),
      ),
    );
  }

  if (res.tempoSegments.length > 0) {
    box.append(
      card(
        `变速段 (${res.tempoSegments.length})`,
        table(
          [{ label: 'tick', num: true }, { label: '时间 (s)', num: true }, { label: 'BPM', num: true }],
          res.tempoSegments.map((t) => [t.ticks, t.timeSec.toFixed(3), t.bpm.toFixed(2)]),
        ),
      ),
    );
  }

  if (res.success === false) {
    banner('err', `生成失败：${res.error}`);
  } else if (res.success) {
    const parts = [
      `生成成功：${res.stats.noteBlockCount} 个音符盒 / ${res.stats.circuitBlocks} 个电路方块`,
      `${res.stats.regionCount} 个区域`,
      `${fmtBytes(res.bytes)}`,
      `${res.stats.elapsedMs}ms`,
    ];
    banner('ok', parts.join(' · '));
  }

  if (res.success) {
    box.append(
      card(
        '生成统计',
        kv([
          ['总 tick 数', res.stats.tickCount],
          ['音符盒', res.stats.noteBlockCount],
          ['电路方块', res.stats.circuitBlocks],
          ['区域数', res.stats.regionCount],
          ['投影大小', fmtBytes(res.bytes)],
          ['耗时', `${res.stats.elapsedMs}ms`],
          ['输出路径', res.outputPath],
        ]),
      ),
    );

    box.append(
      card(
        '区域',
        table(
          ['名称', '原点 (x,y,z)', '尺寸 (x,y,z)', { label: '方块', num: true }],
          res.regions.map((r) => [
            r.name,
            `${r.position.x},${r.position.y},${r.position.z}`,
            `${r.size.x}×${r.size.y}×${r.size.z}`,
            r.blockCount,
          ]),
        ),
      ),
    );

    box.append(
      card(
        '变速换算表',
        table(
          [{ label: '倍率', num: true }, { label: 'tick rate', num: true }, { label: '实际时长', num: true }],
          res.speedTable.map((r) => [`${r.factor.toFixed(2)}×`, r.tickRate, fmtDuration(r.durationSec)]),
        ),
      ),
    );

    // F-12：超出音域必须明确提示，禁止静默失真。
    // 这条不能和"生成成功"挤在一行里被忽略，故单独一段并加前缀。
    if (res.outOfRangeNotes > 0) {
      banner(
        'warn',
        `⚠ 资源包提醒：${res.outOfRangeNotes} 个音符超出原版可用音域。` +
          `未加载 MusicboxMC 资源包时这些音会失真 —— 请安装资源包，或把「超音域处理」改为 clamp/drop。`,
      );
    }
  }
}

function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/* ---------------- 告警渲染 ---------------- */

const WARN_TEXT = {
  POLYPHONY_EXCEEDED: (w) => `tick ${w.tick}：同 tick ${w.n} 个音，超过上限 ${w.limit}，已截断`,
  OUT_OF_RANGE: (w) => `MIDI ${w.midi} 超出可用音域，处理方式：${w.action}`,
  SEGMENT_HARD_CUT: (w) => `tick ${w.tick}：骨架被迫硬切分段`,
  LEAD_IN_USED: (w) => `tick ${w.tick}：用到了骨架前导段（乐曲开头的提前量）`,
  TIMING_ADJUSTED: (w) => `tick ${w.tick} 的音实际在 tick ${w.actual} 触发，偏移 ${w.actual - w.tick} tick`,
  TRACK_SPLIT: (w) => `tick ${w.tick}：${w.notes} 个音密集放不下，已自动拆到新音轨`,
  SPATIAL_DRIFT: (w) => `tick ${w.tick}：该处空间偏差 ${w.drift} 格，超出多轨对齐容差`,
};

function warnSeverity(code) {
  if (
    code === 'TIMING_ADJUSTED' ||
    code === 'TRACK_SPLIT' ||
    code === 'POLYPHONY_EXCEEDED' ||
    code === 'SPATIAL_DRIFT'
  ) {
    return 'warn';
  }
  return 'info';
}

function renderWarnings(warnings) {
  const box = $('warnings');
  box.className = warnings.length === 0 ? 'empty-state compact-empty' : '';
  box.replaceChildren();

  const badge = $('warnCount');
  badge.textContent = String(warnings.length);
  badge.className = 'badge' + (warnings.length > 0 ? ' has' : '');

  if (warnings.length === 0) {
    box.append(
      create('div', 'empty-icon', '✓'),
      create('h3', null, '无告警'),
      create('p', null, '所有音符都落在期望时刻，当前没有需要处理的问题。'),
    );
    return;
  }

  // 同类告警可能成百上千条（密集段落每条一个），按 code 折叠计数
  const counts = new Map();
  for (const w of warnings) counts.set(w.code, (counts.get(w.code) || 0) + 1);

  box.append(
    create(
      'p',
      'hint',
      [...counts.entries()].map(([c, n]) => `${c}×${n}`).join('　'),
    ),
  );

  const shown = warnings.slice(0, 500);
  for (const w of shown) {
    const item = create('div', `warnitem ${warnSeverity(w.code)}`);
    item.append(
      create('span', 'code', w.code),
      create('span', 'detail', (WARN_TEXT[w.code] || (() => JSON.stringify(w)))(w)),
    );
    box.append(item);
  }
  if (warnings.length > shown.length) {
    box.append(create('p', 'hint', `…还有 ${warnings.length - shown.length} 条未显示`));
  }
}

/* ---------------- 预览渲染 ---------------- */

const BLOCK_COLORS = {
  'minecraft:redstone_wire': '#c74e4a',
  'minecraft:repeater': '#a3a19b',
  'minecraft:note_block': '#a86839',
  'minecraft:dirt': '#7a5230',
  'minecraft:grass_block': '#4e8f3d',
  'minecraft:bedrock': '#4a4a52',
};

const FALLBACK_COLORS = ['#b8795f', '#8f9a72', '#c39a64', '#a58270', '#9b8d72', '#7e9690'];
const blockColors = new Map();

function colorOf(block, preview) {
  if (!block) return null;
  if (blockColors.has(block)) return blockColors.get(block);
  if (BLOCK_COLORS[block]) {
    blockColors.set(block, BLOCK_COLORS[block]);
    return BLOCK_COLORS[block];
  }
  const idx = preview.blocks.indexOf(block);
  const c = FALLBACK_COLORS[(idx < 0 ? 0 : idx) % FALLBACK_COLORS.length];
  blockColors.set(block, c);
  return c;
}

function shortName(block) {
  return block.replace(/^minecraft:/, '');
}

function displayBlockName(block) {
  const names = {
    'minecraft:redstone_wire': '红石线',
    'minecraft:repeater': '中继器',
    'minecraft:note_block': '音符盒',
    'minecraft:dirt': '泥土音色',
    'minecraft:grass_block': '草方块音色',
    'minecraft:bedrock': '基岩音色',
  };
  return names[block] || shortName(block);
}

/** 每个格子 38px（96dpi 下约 1cm，用户要求至少 1cm 大）。 */
const CELL = 38;
/** 左侧行头宽度（显示 Z 行号与所属音轨） */
const GUTTER = 150;
/** 顶部刻度尺高度（X 轴 = 时间方向） */
const RULER = 28;
/** 行头与刻度尺的底色 */
const HEAD_BG = '#e9e7e2';
/** Chromium 对单个 canvas 维度有限制；为长曲目预留安全余量。 */
const MAX_CANVAS_PIXELS = 30000;

/** 每个区域一个颜色，用于行头的音轨色条。 */
const REGION_COLORS = ['#c97962', '#c29a65', '#879b79', '#ad8971', '#c58f9c', '#7d9690', '#aa9161'];

/** 该 Z 行属于哪个区域（regions 与预览同坐标系） */
function regionOfRow(res, z) {
  for (let i = 0; i < res.regions.length; i++) {
    const r = res.regions[i];
    if (z >= r.position.z && z < r.position.z + r.size.z) return i;
  }
  return -1;
}

/** 在 (cx, cy) 居中写一行字 */
function label(ctx, text, cx, cy, color, font) {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.fillText(text, cx - ctx.measureText(text).width / 2, cy);
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRoundedRect(ctx, x, y, width, height, radius, fill, stroke) {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function drawTileShadow(ctx, x, y, width, height, radius) {
  ctx.save();
  ctx.shadowColor = 'rgba(75, 61, 49, 0.16)';
  ctx.shadowBlur = Math.max(2, width * 0.08);
  ctx.shadowOffsetY = Math.max(1, width * 0.035);
  fillRoundedRect(ctx, x, y, width, height, radius, '#fff');
  ctx.restore();
}

/**
 * 电路预览：**一行 = 一个实际 Z 行**，一列 = 一格 X（时间方向 →）。
 * 红石线只画线；中继器画成真中继器的样子（石板 + 前后两个红石火把 + 箭头），
 * 档位数字写在上方；音符盒画成音符盒方块，右上角小方块是它下面的方块。
 */
function renderPreview(res) {
  const canvas = $('canvas');
  const hint = $('previewHint');
  const wrap = $('canvasWrap');
  const preview = res && res.preview;

  if (!preview || preview.size.x === 0) {
    canvas.width = 0;
    canvas.height = 0;
    state.previewRenderScale = 1;
    hint.textContent = '尚未生成电路。';
    $('legend').replaceChildren();
    $('previewSize').textContent = '—';
    $('previewRegions').textContent = '—';
    $('previewTracks').textContent = '—';
    $('previewBlocks').textContent = '—';
    updatePreviewZoomLabel();
    return;
  }

  const { x, z } = preview.size;
  const dpr = window.devicePixelRatio || 1;
  const maxCssWidth = Math.max(640, MAX_CANVAS_PIXELS / Math.max(1, dpr));
  const maxCell = (maxCssWidth - GUTTER) / Math.max(1, x);
  const requestedCell = 38 * state.previewScale;
  // 长曲目自动缩小到安全画布尺寸，避免 canvas.width 超过 Chromium 上限后整块空白。
  const CELL = Math.max(1, Math.min(requestedCell, maxCell));
  const renderScale = CELL / 38;
  state.previewRenderScale = renderScale;
  const showGrid = $('showGrid').checked;
  const showNotes = $('showNotes').checked;
  const w = GUTTER + x * CELL;
  const h = RULER + z * CELL;
  const gridX0 = GUTTER;
  const gridY0 = RULER;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'middle';

  const px = (gx) => gridX0 + gx * CELL;
  const pz = (gz) => gridY0 + gz * CELL;

  // ── 顶部刻度尺（X = 时间方向）──
  ctx.fillStyle = HEAD_BG;
  ctx.fillRect(0, 0, w, RULER);
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = '#716d64';
  ctx.fillText('X →（时间）', 8, RULER / 2);
  const step = 10;
  for (let gx = 0; gx <= x; gx += step) {
    const cx = px(gx);
    ctx.strokeStyle = '#c5c1b8';
    ctx.beginPath();
    ctx.moveTo(cx + 0.5, RULER - 6);
    ctx.lineTo(cx + 0.5, RULER);
    ctx.stroke();
    ctx.fillStyle = '#716d64';
    ctx.fillText(String(gx), cx + 3, RULER / 2 - 1);
  }

  // ── 左侧行头（Z 行号 + 所属音轨）──
  ctx.fillStyle = HEAD_BG;
  ctx.fillRect(0, 0, GUTTER, h);
  const trackOf = new Map();
  for (const t of res.tracks || []) trackOf.set(t.index, t);
  for (let gz = 0; gz < z; gz++) {
    const y = pz(gz);
    const absoluteZ = gz + preview.origin.z;
    const ri = regionOfRow(res, absoluteZ);
    const region = ri >= 0 ? res.regions[ri] : null;
    const color = ri >= 0 ? REGION_COLORS[ri % REGION_COLORS.length] : 'rgba(255,255,255,0.12)';

    // 同一区域的整段行用同色左边条，一眼看出哪几行属于同一条轨
    ctx.fillStyle = color;
    ctx.fillRect(0, y, 3, CELL);
    if (region && absoluteZ === region.position.z) {
      const t = trackOf.get(region.trackIndex);
      const label = t ? `轨${region.trackIndex + 1} ${t.instrument}` : `轨${region.trackIndex + 1}`;
      ctx.fillStyle = '#4d4a44';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(label.slice(0, 18), 10, y + CELL / 2);
    }
    ctx.fillStyle = '#8d887f';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(`z${gz}`, GUTTER - 34, y + CELL / 2);
  }

  // ── 格子 ──
  // 垫底方块：淡淡铺一层，看得出下面是什么方块
  for (let gz = 0; gz < z; gz++) {
    for (let gx = 0; gx < x; gx++) {
      const base = preview.baseCells[gz * x + gx];
      if (!base) continue;
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = colorOf(base, preview);
      ctx.fillRect(px(gx), pz(gz), CELL, CELL);
      ctx.globalAlpha = 1;
    }
  }

  // 红石线：用浅色节点卡片 + 连接线表现，避免看起来像一条难以追踪的粗红线。
  const wireAt = (gx, gz) =>
    gx >= 0 && gx < x && gz >= 0 && gz < z
      ? preview.wireCells[gz * x + gx] === 'minecraft:redstone_wire'
      : false;
  const linkAt = (gx, gz) => {
    if (gx < 0 || gx >= x || gz < 0 || gz >= z) return false;
    const b = preview.wireCells[gz * x + gx] || preview.noteCells[gz * x + gx];
    return b === 'minecraft:redstone_wire' || b === 'minecraft:repeater' || b === 'minecraft:note_block';
  };
  const linkDirections = (gx, gz) => ({
    left: linkAt(gx - 1, gz),
    right: linkAt(gx + 1, gz),
    up: linkAt(gx, gz - 1),
    down: linkAt(gx, gz + 1),
  });
  const wireStroke = Math.max(3, CELL * 0.12);
  ctx.strokeStyle = '#c74e4a';
  ctx.lineWidth = wireStroke;
  ctx.lineCap = 'round';
  for (let gz = 0; gz < z; gz++) {
    for (let gx = 0; gx < x; gx++) {
      if (!wireAt(gx, gz)) continue;
      const cx = px(gx) + CELL / 2;
      const cy = pz(gz) + CELL / 2;
      const directions = linkDirections(gx, gz);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      if (directions.right) ctx.lineTo(px(gx + 1) + CELL / 2, cy);
      if (directions.left) ctx.moveTo(cx, cy), ctx.lineTo(px(gx - 1) + CELL / 2, cy);
      if (directions.up) ctx.moveTo(cx, cy), ctx.lineTo(cx, pz(gz - 1) + CELL / 2);
      if (directions.down) ctx.moveTo(cx, cy), ctx.lineTo(cx, pz(gz + 1) + CELL / 2);
      ctx.stroke();

      const degree = Object.values(directions).filter(Boolean).length;
      const nodeRadius = Math.max(3.5, CELL * (degree > 2 ? 0.11 : 0.09));
      ctx.fillStyle = '#fff8f5';
      ctx.beginPath();
      ctx.arc(cx, cy, nodeRadius + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#bf4744';
      ctx.beginPath();
      ctx.arc(cx, cy, nodeRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 中继器：做成清晰的输入 → 延迟 → 输出模块，方向与档位一眼可见。
  for (let gz = 0; gz < z; gz++) {
    for (let gx = 0; gx < x; gx++) {
      if (preview.wireCells[gz * x + gx] !== 'minecraft:repeater') continue;
      const x0 = px(gx);
      const y0 = pz(gz);
      const cx = x0 + CELL / 2;
      const cy = y0 + CELL / 2;
      const inset = Math.max(3, CELL * 0.09);

      drawTileShadow(ctx, x0 + inset, y0 + inset, CELL - inset * 2, CELL - inset * 2, Math.max(4, CELL * 0.12));
      fillRoundedRect(
        ctx,
        x0 + inset,
        y0 + inset,
        CELL - inset * 2,
        CELL - inset * 2,
        Math.max(4, CELL * 0.12),
        '#e1e1de',
        '#a3a19b',
      );

      // 输入输出端点
      ctx.fillStyle = '#bd4d49';
      ctx.beginPath();
      ctx.arc(x0 + Math.max(8, CELL * 0.19), cy, Math.max(3, CELL * 0.08), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e88962';
      ctx.beginPath();
      ctx.arc(x0 + CELL - Math.max(8, CELL * 0.19), cy, Math.max(3, CELL * 0.08), 0, Math.PI * 2);
      ctx.fill();

      // 中心轨道与向右箭头
      ctx.strokeStyle = '#8e8b84';
      ctx.lineWidth = Math.max(2, CELL * 0.055);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0 + CELL * 0.28, cy);
      ctx.lineTo(x0 + CELL * 0.68, cy);
      ctx.stroke();
      ctx.fillStyle = '#68655f';
      ctx.beginPath();
      ctx.moveTo(x0 + CELL * 0.76, cy);
      ctx.lineTo(x0 + CELL * 0.65, cy - CELL * 0.11);
      ctx.lineTo(x0 + CELL * 0.65, cy + CELL * 0.11);
      ctx.closePath();
      ctx.fill();

      const delay = (preview.repeaterDelays || [])[gz * x + gx] || '';
      if (delay) {
        const badgeWidth = Math.max(22, CELL * 0.62);
        const badgeHeight = Math.max(14, CELL * 0.34);
        fillRoundedRect(
          ctx,
          cx - badgeWidth / 2,
          y0 + Math.max(2, CELL * 0.05),
          badgeWidth,
          badgeHeight,
          badgeHeight / 2,
          '#6c6860',
          '#4f4b45',
        );
        ctx.lineWidth = 1;
        label(ctx, `${delay}t`, cx, y0 + badgeHeight / 2 + Math.max(2, CELL * 0.05), '#fffaf2', `bold ${Math.max(9, CELL * 0.22)}px ui-monospace, monospace`);
      }
    }
  }

  // 音符盒：木质主体 + 清晰音符符号 + 底部音色条。
  if (showNotes) {
    for (let gz = 0; gz < z; gz++) {
      for (let gx = 0; gx < x; gx++) {
        const idx = gz * x + gx;
        if (preview.noteCells[idx] !== 'minecraft:note_block') continue;
        const x0 = px(gx);
        const y0 = pz(gz);
        const cx = x0 + CELL / 2;
        const cy = y0 + CELL / 2 + 2;
        const inset = Math.max(3, CELL * 0.08);

        drawTileShadow(ctx, x0 + inset, y0 + inset, CELL - inset * 2, CELL - inset * 2, Math.max(4, CELL * 0.12));
        fillRoundedRect(
          ctx,
          x0 + inset,
          y0 + inset,
          CELL - inset * 2,
          CELL - inset * 2,
          Math.max(4, CELL * 0.12),
          '#a86839',
          '#70401f',
        );

        // 木纹条带，让它和红石/中继器在视觉上明显区分。
        ctx.fillStyle = 'rgba(255, 232, 193, 0.32)';
        ctx.fillRect(x0 + inset + 2, y0 + inset + 3, CELL - inset * 2 - 4, Math.max(2, CELL * 0.07));
        ctx.fillStyle = 'rgba(65, 31, 13, 0.24)';
        ctx.fillRect(x0 + inset + 2, y0 + CELL - inset - Math.max(4, CELL * 0.13), CELL - inset * 2 - 4, Math.max(2, CELL * 0.07));

        // 音符记号
        const noteStem = Math.max(9, CELL * 0.3);
        const noteHead = Math.max(4, CELL * 0.13);
        ctx.fillStyle = '#fff6e7';
        ctx.fillRect(cx + CELL * 0.02, cy - noteStem * 0.9, Math.max(2, CELL * 0.07), noteStem);
        ctx.fillRect(cx + CELL * 0.02, cy - noteStem * 0.9, Math.max(7, CELL * 0.22), Math.max(2, CELL * 0.07));
        ctx.beginPath();
        ctx.ellipse(cx - CELL * 0.11, cy + CELL * 0.12, noteHead, noteHead * 0.78, -0.2, 0, Math.PI * 2);
        ctx.fill();

        // 底部色条代表音符盒下面的方块（音色）。
        const base = preview.baseCells[idx];
        const toneColor = base ? colorOf(base, preview) : '#d7d2c8';
        fillRoundedRect(
          ctx,
          x0 + inset + 3,
          y0 + CELL - inset - Math.max(7, CELL * 0.18),
          CELL - inset * 2 - 6,
          Math.max(7, CELL * 0.18),
          Math.max(2, CELL * 0.06),
          toneColor,
          'rgba(50, 27, 13, 0.35)',
        );
      }
    }
  }

  if (showGrid) {
    ctx.strokeStyle = 'rgba(103, 97, 86, 0.14)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= x; gx++) {
      ctx.beginPath();
      ctx.moveTo(px(gx) + 0.5, gridY0);
      ctx.lineTo(px(gx) + 0.5, h);
      ctx.stroke();
    }
    for (let gz = 0; gz <= z; gz++) {
      ctx.beginPath();
      ctx.moveTo(gridX0, pz(gz) + 0.5);
      ctx.lineTo(w, pz(gz) + 0.5);
      ctx.stroke();
    }
  }

  // 行头与刻度尺的边界
  ctx.strokeStyle = '#c1bdb4';
  ctx.beginPath();
  ctx.moveTo(gridX0 + 0.5, 0);
  ctx.lineTo(gridX0 + 0.5, h);
  ctx.moveTo(0, gridY0 + 0.5);
  ctx.lineTo(w, gridY0 + 0.5);
  ctx.stroke();

  const nonEmpty = preview.wireCells.filter(Boolean).length + preview.baseCells.filter(Boolean).length +
    (showNotes ? preview.noteCells.filter(Boolean).length : 0);
  const trackCount = (res.tracks || []).filter((t) => t.noteCount > 0).length;
  $('previewSize').textContent = `${x} × ${z}`;
  $('previewRegions').textContent = String((res.regions || []).length);
  $('previewTracks').textContent = String(trackCount);
  $('previewBlocks').textContent = String(nonEmpty);
  hint.textContent =
    `一行 = 一个 Z 行，一列 = 一格 X（向右为时间）　·　${x}×${z} 格　·　` +
    `${trackCount} 条音轨 / ${(res.regions || []).length} 个区域　·　可见方块 ${nonEmpty} 个` +
    (renderScale < state.previewScale - 0.005 ? '　·　长曲目已自动缩小预览' : '');

  // 图例
  const legend = $('legend');
  legend.replaceChildren();
  for (const block of preview.blocks) {
    const item = create('span');
    const sw = create('i');
    sw.style.background = colorOf(block, preview);
    item.append(sw, document.createTextNode(displayBlockName(block)));
    legend.append(item);
  }
  legend.append(create('span', 'legend-note', '红石线 · 中继器档位 · 音符盒底色代表音色'));

  wrap.scrollTop = 0;
  wrap.scrollLeft = 0;
  updatePreviewZoomLabel();
}

function updatePreviewZoomLabel() {
  const scale = state.generated ? state.previewRenderScale : state.previewScale;
  $('previewZoom').textContent = `${Math.round(scale * 100)}%`;
}

function setPreviewScale(scale) {
  state.previewScale = Math.min(1.8, Math.max(0.45, scale));
  updatePreviewZoomLabel();
  if (state.generated) renderPreview(state.generated);
}

function fitPreview() {
  const preview = state.generated?.preview;
  const wrap = $('canvasWrap');
  if (!preview || !preview.size?.x || !wrap) return;
  const availableWidth = Math.max(320, wrap.clientWidth - 40);
  const availableHeight = Math.max(220, wrap.clientHeight - 40);
  const widthScale = availableWidth / (GUTTER + preview.size.x * 38);
  const heightScale = availableHeight / (RULER + preview.size.z * 38);
  setPreviewScale(Math.min(1.35, Math.max(0.45, Math.min(widthScale, heightScale))));
}

/* ---------------- 音轨列表 ---------------- */

function renderTrackList(analyze) {
  const box = $('trackList');
  box.replaceChildren();

  const withNotes = analyze.tracks.filter((t) => t.noteCount > 0);
  if (withNotes.length === 0) {
    box.append(create('p', 'hint', '没有含音符的轨。'));
    return;
  }

  for (const t of withNotes) {
    const row = create('div', 'trackrow');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.index = String(t.index);
    cb.id = `trk-${t.index}`;

    const label = create('label', 'tname');
    label.htmlFor = cb.id;
    label.textContent = `${t.index}: ${t.name || shortName(t.instrument) || '(无名)'}`;

    const meta = create('span', 'tmeta', String(t.noteCount));
    row.append(cb, label, meta);
    box.append(row);
  }
}

/* ---------------- 动作 ---------------- */

function setBusy(on) {
  state.busy = on;
  $('btnGenerate').disabled = on || !state.analyze;
  $('btnAnalyze').disabled = on;
  $('btnBrowse').disabled = on;
}

async function doBrowse() {
  try {
    const path = await api.chooseMidi();
    if (!path) return;
    $('filePath').value = path;
    updateWorkflowUI('reading');
    log(`已选择文件 ${path}`);
    await doAnalyze();
  } catch (e) {
    updateWorkflowUI('error');
    banner('err', String(e.message || e));
    log(`选择文件失败：${e.message || e}`);
  }
}

async function doAnalyze() {
  const path = $('filePath').value.trim();
  if (!path) {
    updateWorkflowUI('waiting');
    banner('err', '请先选择 MIDI 文件。');
    return;
  }
  hideBanner();
  setBusy(true);
  updateWorkflowUI('reading');
  try {
    const res = await api.analyze(path);
    state.analyze = res;
    renderOverview(res);
    renderTrackList(res);
    renderWarnings([]);

    // 解析后立即生成内存中的布局结果，让「电路预览」在不落盘的情况下可用。
    // 最终点击「生成投影」时仍会按用户最新参数重新生成并保存。
    try {
      updateWorkflowUI('generating', res);
      const previewRes = await api.generate(path, collectOptions());
      state.generated = previewRes;
      renderWarnings(previewRes.warnings || []);
      renderPreview(previewRes);
      updateWorkflowUI(previewRes.success ? 'ready' : 'error', previewRes);
      if (previewRes.success) {
        log(
          `预览准备完成：${previewRes.stats.noteBlockCount} 音符盒 / ${previewRes.stats.regionCount} 个区域`,
        );
      } else {
        log(`预览准备失败：${previewRes.error || '未知错误'}`);
      }
    } catch (e) {
      state.generated = null;
      renderPreview(null);
      updateWorkflowUI('error');
      log(`预览准备失败：${e.message || e}`);
    }

    log(`解析完成：${res.file} · ${res.song.noteCount} 音符 / ${res.tracks.length} 轨`);
    switchTab('overview');
  } catch (e) {
    state.analyze = null;
    state.generated = null;
    renderPreview(null);
    updateWorkflowUI('error');
    banner('err', String(e.message || e));
    log(`解析失败：${e.message || e}`);
  } finally {
    setBusy(false);
    $('btnGenerate').disabled = !state.analyze;
  }
}

async function doGenerate() {
  const path = $('filePath').value.trim();
  if (!path) return;

  // 未指定输出路径时先问一次，避免"生成了但不知道文件在哪"
  let out = $('outputPath').value.trim();
  if (!out) {
    try {
      const suggested = ($('filePath').value.split(/[\\/]/).pop() || 'output').replace(/\.midi?$/i, '');
      const picked = await api.chooseOutput(suggested);
      if (picked) {
        out = picked;
        $('outputPath').value = picked;
      }
    } catch (e) {
      log(`选择保存位置失败：${e.message || e}`);
    }
  }

  hideBanner();
  setBusy(true);
  updateWorkflowUI('generating', state.analyze);
  switchTab('overview');
  log(`开始生成… ${out ? `输出到 ${out}` : '（不落盘）'}`);
  try {
    const res = await api.generate(path, collectOptions(), out || undefined);
    state.generated = res;
    renderOverview(res);
    renderWarnings(res.warnings);
    renderPreview(res);
    updateWorkflowUI(res.success ? 'generated' : 'error', res);
    log(
      `生成${res.success ? '成功' : '失败'}：${res.success ? `${res.stats.noteBlockCount} 音符盒 / ${fmtBytes(res.bytes)} / ${res.stats.elapsedMs}ms` : res.error}`,
    );
    if (res.outputPath) log(`已保存：${res.outputPath}`);
  } catch (e) {
    updateWorkflowUI('error');
    banner('err', String(e.message || e));
    log(`生成失败：${e.message || e}`);
  } finally {
    setBusy(false);
  }
}

/* ---------------- Tab ---------------- */

function switchTab(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.tab === name);
    tab.setAttribute('aria-selected', tab.dataset.tab === name ? 'true' : 'false');
  }
  for (const pane of document.querySelectorAll('.tabpane')) {
    pane.classList.toggle('active', pane.id === `pane-${name}`);
  }
}

/* ---------------- 绑定 ---------------- */

function bind() {
  $('btnBrowse').addEventListener('click', doBrowse);
  $('btnAnalyze').addEventListener('click', doAnalyze);
  $('btnGenerate').addEventListener('click', doGenerate);

  $('filePath').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doAnalyze();
  });

  $('btnSaveAs').addEventListener('click', async () => {
    const current = $('outputPath').value.trim();
    const suggested = current || (($('filePath').value.split(/[\\/]/).pop() || 'output').replace(/\.midi?$/i, ''));
    const picked = await api.chooseOutput(suggested.replace(/\.litematic$/i, ''));
    if (picked) {
      $('outputPath').value = picked;
      log(`输出路径设为 ${picked}`);
    }
  });

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  }

  for (const id of ['showGrid', 'showNotes']) {
    $(id).addEventListener('change', () => {
      if (state.generated) renderPreview(state.generated);
    });
  }

  $('previewZoomOut').addEventListener('click', () => {
    setPreviewScale(state.previewScale - 0.1);
  });
  $('previewZoomIn').addEventListener('click', () => {
    setPreviewScale(state.previewScale + 0.1);
  });
  $('previewFit').addEventListener('click', fitPreview);
}

bind();
api.onLog((line) => log(line));
updateWorkflowUI('waiting');
log('界面就绪。选择 MIDI 文件开始。');
