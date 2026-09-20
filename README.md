# dsh-synapse

![version](https://img.shields.io/badge/version-0.3.0-3478f6?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-10b981?style=flat-square)
![platform](https://img.shields.io/badge/platform-web-7c3aed?style=flat-square)
![node](https://img.shields.io/badge/node-%3E%3D22.19-334155?style=flat-square)

**A visual, non-linear conversation workspace plugin for DeepSeek Harness.**

把同一工作区中的会话、追问和分支组织成可浏览、可拖拽、可缩放的对话地图，同时保留 DSH 原生的会话能力。

> **这是第三方修改版**，基于原作者 **liangmianya** 的开源项目 [dsh-synapse](https://github.com/liangmianya/dsh-synapse) 修改而来，遵循 **MIT** 许可证。详见文末「来源与致谢」。

[中文指南](docs/zh-CN/README.md) · [English guide](docs/en/README.md) · [Development](docs/development.md) · [Architecture](docs/architecture.md)

![Synapse workspace canvas](docs/images/synapse-ui.png)

## Overview

`dsh-synapse` adds a visual session map to the native DeepSeek Harness Web interface. It projects committed DSH conversations into connected cards, keeps forks attached to their real branching turns, and synchronizes the current session between the map and native chat.

Synapse is an interface layer, not a second conversation system. DSH continues to own sessions, model requests, tools, permissions, and the Web server.

## Features

| | Feature | 功能 |
|---|---|---|
| 🗺️ | Browse sessions and turns as a connected canvas | 将会话和追问显示为连线画布 |
| 🌿 | Preserve native DSH fork lineage | 按真实分叉点显示 DSH 分支 |
| 📁 | Group sessions by DSH workspace and directory | 按工作区和目录组织会话 |
| 📥 | Project committed and streaming replies into cards | 将已提交和流式回复投影到卡片 |
| 🔧 | Fold tool calls and results into assistant replies | 将工具调用和结果折叠到助手回答 |
| ⚡ | Synchronize the active session with native chat | 与 DSH 原生对话双向同步当前会话 |
| 🎨 | Pan, zoom, drag, fold descendant subtrees, focus, and persist card positions | 支持平移、缩放、拖动、展开/折叠后续子树、定位和位置保存 |
| 💾 | Mirror the canvas layout to the DSH home, so it survives another browser or cleared site data | 画布布局镜像到本地服务端，换浏览器/清缓存不丢 |

![Native dialogue and Synapse toggle](docs/images/native-webui.png)

## Quick start

Requirements: DeepSeek Harness with the profile plugin mechanism, Node.js `>= 22.19.0`, and the `web` profile.

```powershell
corepack pnpm dsh plugin --profile web add dsh-synapse
corepack pnpm dsh web
```

Open `http://127.0.0.1:3080/` and select **Session Map / 会话地图** from the top switch.

> [!NOTE]
> Synapse extends the existing DSH Web profile. It does not start a second application server. The npm package needs no build permission; Git and local-checkout installs are documented in the installation guide.

## Documentation

| Document | Description |
|---|---|
| [中文指南](docs/zh-CN/README.md) | 安装、启动、配置、使用、卸载和已知限制 |
| [English guide](docs/en/README.md) | Installation, configuration, usage, cleanup, and limitations |
| [Development and releases](docs/development.md) | Local validation, GitHub Actions, version tags, and npm publishing |
| [Architecture and boundaries](docs/architecture.md) | Session ownership, projection, storage, model impact, and operational limits |

## Development

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm test
```

See the [development and release guide](docs/development.md) for CI/CD and npm publication details.

## Runtime boundaries

- DSH session logs remain the source of truth for conversation content.
- Synapse stores the workspace projection in `$DSH_HOME/synapse/workspaces.json` and mirrors the canvas UI state (folders, card positions, edges, hidden/locked cards, quick phrases) to `$DSH_HOME/synapse/state.json`. `localStorage` stays a synchronous cache, so the same layout follows you across browsers, origins (`localhost` vs `127.0.0.1`) and cleared site data; the first browser to load after upgrading seeds the file automatically.
- Projected card text is capped at 8000 characters; the full message remains available in conversation details.
- The plugin does not modify prompts, model requests, tool schemas, provider routing, or reusable KV-cache prefixes.
- Only the DSH `web` profile is supported by the bundled patch.

See [Architecture and runtime boundaries](docs/architecture.md) for the complete model.

## 来源与致谢 / Credits

本修改版基于开源项目 **dsh-synapse** 二次开发：

- 原项目：`dsh-synapse`
- 原作者：**liangmianya**
- 原仓库：<https://github.com/liangmianya/dsh-synapse>
- 原许可证：**MIT**

原项目采用 **MIT 许可证**，允许任何人免费使用、修改、分发（含商业用途），**前提是保留版权与许可证声明**。本文件夹已保留原始 `LICENSE` 文件。

> **再分发请注意**：
> 1. 保留 `LICENSE`（MIT）与本页的“来源与致谢”；
> 2. 在显眼位置注明原项目及本修改版来源；
> 3. 本项目名 / Logo（`deepseek-mark.svg`）涉及商标，MIT 只覆盖代码，不代表官方背书，请勿暗示与原厂 / 原作者存在官方关联。

## License

[MIT](LICENSE)
