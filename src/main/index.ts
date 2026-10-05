import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { analyzeFile, generate, generateToFile, type GenerateOptions } from './service';

/**
 * 静态资源定位。编译产物布局为 dist/src/main/index.js，
 * 即 __dirname = <root>/dist/src/main，故用一级 ".." 回到 <root>/dist/src。
 */
const RENDERER_DIR = join(__dirname, '..', 'renderer');
const PRELOAD_FILE = join(__dirname, '..', 'preload', 'index.js');

let win: BrowserWindow | null = null;

function logToRenderer(line: string): void {
  win?.webContents.send('app:log', line);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'MusicboxMC',
    backgroundColor: '#f5f5f2',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(join(RENDERER_DIR, 'index.html'));

  win.on('closed', () => {
    win = null;
  });
}

/** 渲染进程回传的路径必须是真实存在的文件，避免把任意字符串当路径用。 */
function assertFile(path: unknown): string {
  if (typeof path !== 'string' || path.length === 0) throw new Error('缺少文件路径');
  if (!existsSync(path)) throw new Error(`文件不存在：${path}`);
  return path;
}

function registerIpc(): void {
  ipcMain.handle('dialog:choose-midi', async () => {
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: '选择 MIDI 文件',
      properties: ['openFile'],
      filters: [
        { name: 'MIDI', extensions: ['mid', 'midi'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]!;
  });

  ipcMain.handle('dialog:choose-output', async (_e, defaultName: unknown) => {
    const raw = typeof defaultName === 'string' && defaultName.length > 0 ? defaultName : 'output';
    const name = raw.replace(/\.litematic$/i, '');
    const res = await dialog.showSaveDialog(win ?? undefined!, {
      title: '保存投影',
      defaultPath: `${name}.litematic`,
      filters: [{ name: 'Litematica 投影', extensions: ['litematic'] }],
    });
    return res.canceled || !res.filePath ? null : res.filePath;
  });

  ipcMain.handle('song:analyze', (_e, path: unknown) => {
    try {
      return analyzeFile(assertFile(path));
    } catch (e) {
      throw new Error(`解析失败：${(e as Error).message}`);
    }
  });

  ipcMain.handle(
    'song:generate',
    (_e, path: unknown, options: GenerateOptions, outputPath: unknown) => {
      try {
        const file = assertFile(path);
        if (typeof outputPath === 'string' && outputPath.length > 0) {
          return generateToFile(file, outputPath, options ?? {});
        }
        return generate(file, options ?? {}).result;
      } catch (e) {
        throw new Error(`生成失败：${(e as Error).message}`);
      }
    },
  );

  ipcMain.handle('shell:reveal', (_e, path: unknown) => {
    if (typeof path === 'string' && existsSync(path)) shell.showItemInFolder(path);
  });

  ipcMain.handle('shell:open', async (_e, path: unknown) => {
    if (typeof path !== 'string' || !existsSync(path)) return;
    const err = await shell.openPath(path);
    if (err) throw new Error(err);
  });
}

app.whenReady().then(() => {
  // The renderer owns the application chrome; keep Electron's native File/Edit menu hidden.
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (e) => {
  logToRenderer(`[主进程异常] ${e.message}`);
});
