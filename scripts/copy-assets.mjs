import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * tsc 只编译 .ts，渲染进程的 .html/.css/.js 需要手动搬到 dist。
 * 目标路径必须与 src/main/index.ts 里 RENDERER_DIR 的推算一致：
 *   dist/src/main/index.js → __dirname/../renderer = dist/src/renderer
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, 'src', 'renderer');
const to = join(root, 'dist', 'src', 'renderer');

if (!existsSync(from)) {
  console.error(`[copy-assets] 源目录不存在：${from}`);
  process.exit(1);
}

mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`[copy-assets] ${from} → ${to}`);

const iconFrom = join(root, 'icon.png');
const iconTo = join(root, 'dist', 'src', 'main', 'icon.png');
if (existsSync(iconFrom)) {
  mkdirSync(dirname(iconTo), { recursive: true });
  cpSync(iconFrom, iconTo);
  console.log(`[copy-assets] ${iconFrom} → ${iconTo}`);
}
