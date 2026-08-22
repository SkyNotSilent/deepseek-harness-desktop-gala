# 参与贡献

欢迎提 Issue 和 Pull Request。

## 开发环境

- Node.js 22.19+（或 24.x）与 Corepack；仓库固定使用 Yarn 4.18。
- `corepack yarn install --immutable` 安装依赖，`corepack yarn dev` 启动开发版。
- `corepack yarn check` 是合入门槛：两个 workspace 的构建、类型检查、全部测试，以及打包闭包与 Loader smoke。

## 提交规范

- 提交信息使用 `type: description` 形式，type 取 `feat / fix / refactor / docs / test / chore / perf / ci`。
- 新功能先写测试（Vitest），再实现；修 bug 先补一个会失败的用例。
- 改动用户可见文案时同步更新 `docs/user-guide.md`。

## 贡献 Gala 角色或皮肤

- 角色定义在 `dsh-plugin-gala/src/gala-officials.ts`，皮肤在 `gala-character-skins.ts`，协议在 `src/protocols/`。
- 新增角色请附带 `portrait-v2.webp`（1254×1254）、`hero-v2.webp`（1672×941）与三张 512×512 表情图，放在 `assets/gala/officials/<slug>/assets/`。
- 角色图请确认你拥有使用与再分发的权利；仓库以 MIT 许可发布。

## 报告问题

请附上操作系统、应用版本（托盘菜单或「关于」）、复现步骤，以及托盘终端里能看到的错误输出。涉及账号或密钥的内容请先脱敏。
