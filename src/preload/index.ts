import { contextBridge, ipcRenderer } from 'electron';
import type { AnalyzeResult, GenerateOptions, GenerateResult } from '../main/service';

/**
 * 渲染进程可见的唯一入口。
 *
 * 逐功能通道：每个方法对应一个具名 IPC channel，主进程按功能返回结构化数据。
 * 渲染进程始终拿不到 Node API（contextIsolation + sandbox 全程开启），
 * 文件路径由主进程的对话框产出，渲染进程只能回传路径字符串。
 */
export interface MusicboxApi {
  /** 打开文件对话框，返回所选 MIDI 路径；取消返回 null */
  chooseMidi(): Promise<string | null>;
  /** 选择 .litematic 保存位置；取消返回 null */
  chooseOutput(defaultName: string): Promise<string | null>;
  /** 只解析，不生成电路 */
  analyze(path: string): Promise<AnalyzeResult>;
  /** 完整生成；输出路径为空时只生成不落盘 */
  generate(path: string, options: GenerateOptions, outputPath?: string): Promise<GenerateResult>;
  /** 在系统文件管理器中定位文件 */
  reveal(path: string): Promise<void>;
  /** 用系统默认程序打开文件 */
  open(path: string): Promise<void>;
  /** 主进程打印的日志（例如未捕获异常），用于在界面上回显 */
  onLog(handler: (line: string) => void): void;
}

const api: MusicboxApi = {
  chooseMidi: () => ipcRenderer.invoke('dialog:choose-midi'),
  chooseOutput: (defaultName) => ipcRenderer.invoke('dialog:choose-output', defaultName),
  analyze: (path) => ipcRenderer.invoke('song:analyze', path),
  generate: (path, options, outputPath) =>
    ipcRenderer.invoke('song:generate', path, options, outputPath),
  reveal: (path) => ipcRenderer.invoke('shell:reveal', path),
  open: (path) => ipcRenderer.invoke('shell:open', path),
  onLog: (handler) => {
    ipcRenderer.on('app:log', (_e, line: string) => handler(line));
  },
};

contextBridge.exposeInMainWorld('musicbox', api);
