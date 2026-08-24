# 角色独立空间

DSH Desktop Gala 从 `2.1.0-preview.2` 起把“看起来是谁”和“运行在哪套插件环境”拆成两条状态轴：

- **外观（Appearance）**：原装、经典配色、GALA·群星、官方角色或自定义角色。
- **工作台（Workspace）**：公共空间，或某个 IP 的内部受管 Profile。

## 默认与迁移

- 干净安装第一次启动使用「GALA·群星」。
- `skins.json` 升级为 v2，明确区分“从未初始化”和“用户选择原装”。旧 v1 的字符串皮肤 ID 原样保留，旧 v1 的 `active: null` 继续解释为原装。
- 角色独立空间默认关闭；未开启时不会创建任何内部 Profile。
- 「恢复原装」只表示无 Gala 外观，不再等于集合皮肤，也不进入角色图鉴。

## 开启与切换

入口位于 **设置 → 插件 → 角色空间**（换肤弹层里也有同一个开关）。点击“开启”先展开说明卡（`GalaWorkspaceExplainer`，文案单一来源 `WORKSPACE_EXPLAINER`）：它会做什么、什么仍共享、代价与风险、适合谁；用户确认后才发出 `workspace-enable`。关闭同样先确认（`WORKSPACE_DISABLE_EXPLAINER`），并在角色工作台内明确提示会重启。开启时会冻结当前公共 Profile 的 bundle 清单、Profile patch 和过滤敏感字段后的设置文件。每个角色在首次进入时基于同一份种子懒创建，因此不会因进入时间不同而漂移。

角色 Profile 名称由角色 ID 决定：官方角色使用稳定 slug，自定义角色使用角色 ID 的 SHA-256 短哈希。显示名称不会直接进入路径。所有内部 Profile 带 `dsh.galaWorkspace` 标记并从普通托盘 Profile 列表隐藏。

切换顺序固定为：准备/修复目标 → 同步公共插件目录 → 校验 bundle 顺序和依赖闭包 → 写入目标外观 → 写 pending Profile → 有序重启。准备失败不会写 pending；Electron 拒绝重启时会撤销 pending；新工作台挂载失败时沿用 Desktop 的 last-known-good 回滚。

## 插件与数据边界

- 插件包和 pnpm Store 共享；每个 Profile 只保存自己的 bundle 启停状态与非敏感设置。
- 当前角色通过 DSH Terminal 安装的新 bundle 会进入公共目录；该角色默认开启，其他角色下次进入时可见但默认关闭。
- 插件编队允许批量暂存，点击“应用并重启”只重启一次。第三方 bundle 按完整 bundle 管理，不拆分未知内部 Loader 行。
- 基座、Web 外壳、Agent、模型、会话与命令主链锁定，不能关闭。
- API Key、凭据、聊天记录、工作目录、Session Storage 与窗口偏好仍使用共享服务，不复制到角色 Profile。
- 关闭独立空间只返回公共 Profile，不删除角色数据。当前阶段也不会自动删除自定义角色对应的空间。

## 本地调试

```sh
corepack yarn dev
```

在应用中进入 **设置 → 插件 → 角色空间** 开启独立模式，再从 Gala 皮肤图鉴选择两个角色做往返。检查点：

0. 点击“开启”先出现说明卡，列出作用 / 共享边界 / 代价风险；取消不改变任何状态。
1. 第一次选角色会出现“保存并重启”确认。
2. 重启后状态栏同时显示外观和工作台。
3. 某角色关闭一个非核心 bundle 后，另一个角色不受影响。
4. 在独立模式恢复原装时，可选择只恢复外观，界面应显示“外观：原装｜工作台：角色名”。
5. 关闭独立模式后回到公共空间，但当前外观和角色 Profile 目录仍保留。

受管状态位于应用 userData 的 `gala/workspaces.json` 与 `gala/workspace-seed/`；角色 Profile 位于 DSH Home 的 `profiles/gala-*`。不要手工从托盘直接启动这些内部 Profile。
