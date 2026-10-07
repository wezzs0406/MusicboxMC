# MusicboxMC

<p align="center">
  <img src="icon.png" alt="MusicboxMC Logo" width="128" height="128" />
</p>

<p align="center">
  <strong>MIDI → Minecraft 红石音乐 <code>.litematic</code> 投影生成器</strong>
</p>

<p align="center">
  基于 Electron + TypeScript 构建的桌面端工具，一键将任意 MIDI 文件转换为可直接在 Minecraft 中自动演奏的红石音乐投影结构。
</p>

---

## 📖 项目简介

**MusicboxMC** 旨在解决传统 Minecraft 红石音乐制作门槛高、耗时长、音域受限以及多轨排线容易错拍的问题。通过自动化的电路布局算法，将输入的 MIDI 乐曲精确量化并编译为符合原版游戏特性的红石电路网络，最终导出为 Litematica 投影模组支持的 `.litematic` 格式。

玩家只需将生成的投影粘贴至单机存档或服务器中，在起点接通红石信号，即可获得高保真、同刻对齐、原汁原味的红石音乐体验。

---

## ✨ 核心特性

- **🎹 智能化红石拓扑与电路布局**
  - **内联式主线排布**：中继器与音符盒内联布置，采用强充能传导机制，省去冗余布线，信号稳定不丢音。
  - **自适应和弦与复音结构**：支持单音与 $\le 3$ 音和弦一跳导电，密集多音和弦自适应横向分支，同刻发声零延迟偏差。
  - **多轨空间对齐（Spatial Alignment）**：各音轨按曲中时刻统一协同推进，消除稀疏轨与密集轨在长曲中因走线长度累积导致的物理空间漂移，确保近距离聆听各声部平衡。
  - **同乐器自动并轨（可选）**：支持将相同乐器/通道合并至同一物理主线，进一步精简电路占地。

- **⏱️ 严格的游戏刻/红石刻对齐与变速**
  - 按曲目 BPM 精确将 MIDI 绝对时间量化为红石刻（$1\text{ 红石刻} = 2\text{ 游戏刻} = 0.1\text{s}$）。
  - 自动组合中继器档位（1~4 档），毫秒级控制音符时值。
  - 输出与原版 `/tick rate` 命令兼容的速度换算表，支持全曲无损整体变速。

- **🎼 全音域拓展与音色映射**
  - 完美适配 88 键钢琴全音域资源包，突破 Minecraft 原版音符盒 2 个八度（24 个半音）的物理限制。
  - 通过音符盒下方垫块材质（泥土、草方块、基岩等）区分音区槽位，还原真实乐器跨八度音色。
  - 具备智能音域越界检测与降级提醒，保证旋律完整。

- **🖥️ 现代桌面端交互与 NBS 风格电路预览**
  - 简洁美观的桌面界面，支持 MIDI 元数据（曲名、拍号、BPM、轨道乐器、音符数）一览。
  - **类 NBS (Note Block Studio) 的交互式电路预览**：高清晰度展示各音轨 Z 轴空间排布、X 轴时间推进线、中继器指向与档位、音符盒位置，支持缩放与平移查看。

- **📦 纯原生 Litematica 格式构建**
  - 内部实现纯 TypeScript 的 NBT 二进制编解码器与 Litematica BitArray 紧凑位打包算法。
  - 产出完全符合 1.20.4+ 格式规范的 `.litematic` 投影文件，可直接被 Litematica 模组加载。

---

## 🛠️ 技术架构

```text
MusicboxMC/
├── src/
│   ├── core/                  # 核心计算与转换引擎（纯逻辑、无 GUI 依赖）
│   │   ├── midi/              # MIDI 解析与音符流规范化 (@tonejs/midi)
│   │   ├── tempo/             # BPM、Tick 网格量化与变速计算
│   │   ├── palette/           # 音高档位映射与音符盒垫块方案
│   │   ├── layout/            # 红石拓扑布线、和弦分支与多轨空间对齐算法
│   │   ├── nbt/               # NBT 二进制序列化与反序列化
│   │   └── litematic/         # Litematica 投影文件打包与 GZIP 压缩
│   ├── main/                  # Electron 主进程与 IPC 服务
│   ├── preload/               # 上下文隔离安全桥接层
│   └── renderer/              # 客户端 UI 界面与 Canvas 电路预览器
├── scripts/                   # 构建脚本与开发辅助工具
├── test/                      # Vitest 自动化单元/集成测试套件
└── config.default.jsonc       # 默认生成配置
```

---

## 🚀 快速上手

### 环境准备

确保您的本地计算机已安装：
- [Node.js](https://nodejs.org/) (推荐 LTS 18.x 或更高版本)
- npm (随 Node.js 一并安装)

### 安装与运行

1. **克隆仓库**
   ```bash
   git clone https://github.com/wezzs0406/MusicboxMC.git
   cd MusicboxMC
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动客户端**
   ```bash
   npm start
   ```

4. **运行自动化测试**
   ```bash
   npm test
   ```

5. **执行类型检查与构建**
   ```bash
   npm run build
   ```

### 命令行工具 (CLI)

如需快速查看某个 MIDI 文件的音乐结构而无需打开图形界面，可运行：
```bash
npm run cli -- --midi <path/to/your/song.mid>
```

---

## 🎮 游戏内使用方法

1. 在 MusicboxMC 中点击 **选择 MIDI 文件** 导入您的乐曲。
2. 在右侧配置面板调整需要生成的参数（如：主线间距、是否同乐器并轨、全音域拓展等）。
3. 点击 **生成 .litematic 投影** 并选择保存路径。
4. 将生成的 `.litematic` 文件放入您的 Minecraft 游戏目录：
   ```text
   .minecraft/schematics/
   ```
5. 安装 [Litematica](https://masa.dy.fi/mcmods/client_mods/?mod=litematica) 模组并进入游戏。
6. 按 `M` 打开模组菜单，加载该投影并放置在世界中。
7. 在主线起点红石粉处接入拉杆或信号脉冲，即可享受演奏！

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 开源。
