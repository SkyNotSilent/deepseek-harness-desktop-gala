<p align="center">
  <img src="assets/screenshot-welcome.webp" alt="DeepSeek Harness Desktop Gala 角色舞台欢迎页" width="100%">
</p>

<h1 align="center">DeepSeek Harness Desktop Gala</h1>

<p align="center">
  <a href="https://github.com/SkyNotSilent/deepseek-harness-desktop-gala/releases"><img src="https://img.shields.io/github/v/release/SkyNotSilent/deepseek-harness-desktop-gala?include_prereleases&style=flat&label=release&color=7b5fd4" alt="Latest release"></a>
  <a href="https://github.com/SkyNotSilent/deepseek-harness-desktop-gala/actions/workflows/ci.yml"><img src="https://github.com/SkyNotSilent/deepseek-harness-desktop-gala/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows-47848F?style=flat" alt="macOS and Windows">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License"></a>
</p>

<p align="center"><sub>中文 · <a href="README.en.md">English</a></sub></p>

<p align="center">
  <b>把 DeepSeek Harness 装进桌面，再给它一个角色。</b><br>
  一个开箱即用的 DeepSeek Harness（DSH）桌面端，内置 <b>Gala 角色皮肤系统</b>：「GALA·群星」默认登场，十位角色可独立换装，整片舞台背景始终相随。
</p>

<h3 align="center">
  <a href="https://skynotsilent.github.io/deepseek-harness-desktop-gala/">📥 下载页面</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/SkyNotSilent/deepseek-harness-desktop-gala/releases">GitHub Releases</a>
</h3>

<p align="center"><sub>如果这个项目让 DSH 更好用，欢迎点一个 ⭐ Star 关注后续更新。</sub></p>

<p align="center">
  <img src="assets/screenshot-chat.webp" alt="进入对话后角色舞台背景仍然常驻" width="100%">
</p>

## 这是什么

DeepSeek Harness 是一个"万物皆插件"的 Agent 运行时，官方提供命令行与 Web 界面。**DeepSeek Harness Desktop Gala** 把同一个运行时封装成 macOS / Windows 应用：双击启动、系统托盘常驻、内置终端、自动检查更新——并在此之上做了一件官方没做的事：**让界面有角色**。

首次启动从开屏开始就由十位 Gala 角色与鲸鱼共同组成的「GALA·群星」登场；以后开屏会跟随上次成功使用的角色或外观。选中单独角色后，侧边栏头像、欢迎页标题、整片对话舞台背景和界面配色会一起换装。「GALA·群星」是图鉴里的正式默认 IP；「恢复原装」则会清除 Gala 人物、背景、品牌与配色。三套经典配色保持纯净、无人物的界面。角色是贯穿使用过程的陪伴，不只是换个主题色。

> 本项目是社区作品，**不是 DeepSeek 官方产品**。完全开源免费；如有人向你出售此软件，请拒绝。

## 功能

| | |
|---|---|
| 🎀 **Gala 角色皮肤** | 默认由十位角色与鲸鱼共同登场；也可切换阿基、小窗、阿念、灵灵、盾盾、敲敲、巧巧、忆忆、令令或宝宝。每套都有专属配色、头像、舞台立绘与寄语；支持导入 `.ggal` 角色包、收藏与合成。 |
| 💬 **个性化人物** | 十位官方角色各自带人物设定（傲娇天才阿念、御姐大姐姐阿基、粘人管理员忆忆、星海巫女灵灵……）。开启后，换上谁的皮肤，模型就用谁的语气回答；代码、命令与事实不受影响。默认关闭，可在设置或换肤弹层一键开启；全员群星、经典配色与原装始终不带人物语气。 |
| 🪐 **角色独立空间** | 默认关闭；开启前会先展示它做什么、什么仍共享、要付出的代价与风险，确认后才生效。开启后，全体、官方角色和自定义角色可拥有独立 Profile、非敏感设置与插件编队。切换角色会先校验目标空间，再保存状态并有序重启；凭据、聊天与工作目录继续共享。 |
| 🖼️ **多模态对话** | 跟随 DeepSeek Harness 0.1.1，支持图片输入与 DeepSeek-V4 Flash Vision。 |
| 🖥️ **零配置本地 Host** | 安装包自带 Electron、Node 与固定版本的 DSH 运行时；首次启动自动准备默认 profile，无需安装 Node.js 或 pnpm。 |
| 🧩 **插件生态兼容** | 继续使用官方 `dsh plugin` 语义管理插件；兼容模式保留上游 Web 客户端，高级模式提供桌面自有布局与窗口材质。 |
| 🧰 **托盘、终端、profile** | 托盘一键打开带好环境变量的终端；多 profile 切换；关闭窗口不退出。 |
| 🔄 **安全的更新策略** | 后台检查 GitHub Releases；Preview 只提示不下载，签名正式版下载与安装前各确认一次。 |

## 安装

从 [下载页面](https://skynotsilent.github.io/deepseek-harness-desktop-gala/) 获取对应系统的安装包：

- **macOS（Apple Silicon）**：`DeepSeek-Harness-Desktop-Gala-<版本>-arm64.dmg`，拖入"应用程序"。
- **Windows x64**：`DeepSeek-Harness-Desktop-Gala-<版本>-x64-Setup.exe`，按向导安装。

### 首次启动的系统提示

- macOS Preview 使用 Developer ID 签名并通过 Apple 公证，拖入「应用程序」后可正常打开；当前只支持 Apple Silicon。
- Windows Preview 尚未做 Authenticode 签名；SmartScreen 弹窗中点击「更多信息 → 仍要运行」。

每个 Release 都附带 `SHA256SUMS.txt` 供校验。

### 配置 API Key

第一次发送消息前，在 **设置 → 模型** 填入 DeepSeek API Key。密钥保存在本机 `~/.dsh/.credentials.yaml`，不会进入仓库或安装包。账户余额不足时，界面会直接提示并给出充值入口。

## 使用 Gala

- 侧边栏底部 **🎀 Gala皮肤图鉴** 打开换装面板。图鉴第一张「GALA·群星」回到十位角色与鲸鱼共同登场的群星皮肤；「恢复原装」清除全部 Gala 外观。三套经典配色仍可单独选择。
- **设置 → 插件 → 角色空间** 可开启“角色独立空间（硬核）”（开启前有完整说明与确认）、查看当前外观/工作台、开关“个性化人物”（默认关闭，换肤弹层里也有同一开关）并查看当前角色的人物设定，还能批量调整当前角色的插件编队。系统必需插件会锁定；安装与升级继续在 DSH Terminal 完成。
- 托盘菜单提供 **嘎啦图鉴 / 换肤面板 / 合成工坊 / 导入嘎啦包**；快捷键 `Cmd/Ctrl + Shift + S` 直达换肤面板。
- 角色数据与皮肤协议见 [`dsh-plugin-gala/`](dsh-plugin-gala/)。

<p align="center"><a href="https://skynotsilent.github.io/deepseek-harness-desktop-gala/"><img src="assets/screenshot-site-home.webp" alt="DeepSeek Harness Desktop Gala 下载站与角色舞台" width="100%"></a></p>

更多说明见 [用户指南](docs/user-guide.md)。

## 从源码运行

需要 Node.js 22.19+ 与 Corepack（Yarn 4）。

```sh
git clone https://github.com/SkyNotSilent/deepseek-harness-desktop-gala.git
cd deepseek-harness-desktop-gala
corepack yarn install --immutable
corepack yarn dev
```

`corepack yarn check` 运行构建、类型检查、全部测试与打包闭包校验；`corepack yarn package:dir` 生成本机未签名应用。角色空间状态模型见 [docs/role-workspaces.md](docs/role-workspaces.md)，架构、插件接口与发布流程见 [docs/](docs/README.md)。

## 仓库结构

```
dsh-plugin-desktop/   Electron 壳：窗口、托盘、profile、终端、更新、打包
dsh-plugin-gala/      Gala 角色系统：角色库、皮肤、图鉴面板、.ggal 包、品牌座位
site/                 下载站（GitHub Pages）
docs/                 用户指南、架构、插件开发、发布流程
.github/workflows/    CI、Preview 发布、签名发布、站点部署
```

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供了 Agent、模型、工具、会话与 Web UI 的全部核心能力。
- [Cordis](https://github.com/cordiverse/cordis) 提供了让"桌面本身也是插件"成立的插件框架。

## 许可

[MIT License](LICENSE)。
