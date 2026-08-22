# 桌面 service 参考

桌面端向插件作者公开两个 Host service：`desktopProfiles` 与 `desktopPnpm`。它们在兼容与高级两种模式下都存在，都运行在 Electron main 进程的 Host 里，都随 Cordis 的一代生灭。本文是这两个 service 的接口合同；不在这里的东西（`desktopRuntime`、`desktopPnpmBootstrap`、`galaHost`、任何 Electron 对象）都不是第三方接口。

## 导入类型

```ts
import type { DesktopProfiles, DesktopCurrentProfile } from 'dsh-plugin-desktop/profile-service'
import type { DesktopPnpm, DesktopPnpmHandle, DesktopPnpmOutcome } from 'dsh-plugin-desktop/pnpm'
```

只做 type-only 导入；编译后不会留下运行时依赖。`dsh-plugin-desktop/profiles` 是托盘菜单的实现，不是合同路径。

## 生命周期

启动器在 Loader 挂载之前注册 `desktopProfiles`，因此它是否存在可以用来判断"我是否运行在桌面端"。切换 profile 或模式会销毁整代 Host 再新建一代——缓存的 service 引用在那之后失效，请在每一代里重新读取。

## `desktopProfiles`

```ts
interface DesktopProfiles {
  readonly current: { readonly name: string; readonly dir: string }
  list(): readonly DesktopProfileSummary[]
  select(name: string): Promise<void>
}
```

- `current` 在一代内不变：`name` 是启动器选中的 profile，`dir` 是它 manifest 的绝对目录。不要用 argv、settings、`ctx.baseUrl` 或 `$DSH_HOME` 去猜。
- `list()` 重新读取各 profile 的 manifest，只读；返回项里可能包含"可见但不可选"的 profile（无 Web 能力、manifest 损坏等）。
- `select(name)` 不是就地切换：它先持久化目标，再请求有序关闭与重启。同一目标的并发调用共享一次操作；已有待生效目标时，其他目标会被拒绝。持久化失败释放选择槽，重启失败保留目标以便重试。
- service 销毁后继续调用会抛错。

## `desktopPnpm`

```ts
interface DesktopPnpm {
  run(args: readonly string[], signal?: AbortSignal): DesktopPnpmHandle
  runPlugin(args: readonly string[], invokingDir: string, signal?: AbortSignal): DesktopPnpmHandle
}

interface DesktopPnpmHandle {
  readonly stdout: NodeJS.ReadableStream
  readonly stderr: NodeJS.ReadableStream
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>
  cancel(): void
}
```

| 方法 | 进程 | 用途 |
| --- | --- | --- |
| `run(args)` | 直接执行内置 pnpm 的 JavaScript 入口，cwd = 当前 profile 目录 | 明确不需要 DSH 插件语义的低层 pnpm 操作 |
| `runPlugin(args, invokingDir)` | 执行打包的 `dsh plugin --profile <当前> …`，cwd = 调用方给的绝对目录 | 安装、卸载、更新插件，修复依赖 |

`runPlugin` 的 `args` 是追加在 `dsh plugin --profile <当前>` 之后的参数，例如 `['add', 'x']`、`['remove', 'x']`、`['update']`、`['install', '--no-frozen-lockfile']`。只有它保证首次 profile 初始化、相对 `file:` / `link:` 源的锚定，以及成功后对 `dsh.profile.bundles` 的同步；`run` 不做这些，用错方法会出现"包装上了但没进 Loader"的状态。

规则：

- `args` 非空且不含 NUL；`invokingDir` 必须是绝对路径。违反者、service 已关闭、已有操作进行中、signal 已 abort——都在返回 handle 之前同步抛错。
- 一代 Host 同时只允许一个包操作。
- service 只暴露输出流，不做进度 UI，也没有内置超时。调用方负责超时、读两个流、在需要时 `cancel()`、等待 `done`，并同时检查 `exitCode` 与 `signal`。
- `done` 在完整子进程树退出后才 settle；spawn 级失败 reject，命令失败 resolve 为非零退出码。取消与整代销毁都作用于整棵进程树。
- Windows 下以 argv 直接启动打包入口，不经过 shell，也不需要 `.cmd` shim。

## 注入模式

**只在桌面端运行**——两个 service 直接放进 `inject`，Cordis 会等它们就绪：

```ts
export const inject = ['desktopProfiles', 'desktopPnpm']
```

**同时支持普通 DSH**——顶层只注入普通依赖，回调里探测 `desktopProfiles`，存在时再用 `ctx.inject(['desktopPnpm'], …)` 挂桌面分支，不存在时走原有实现。`ctx.inject` 里的每个名字在该回调内仍是必需依赖，所以桌面分支会等到 `desktopPnpm` 就绪，而外层插件不受影响。

`desktopProfiles` 存在后绝不要退回猜测的 `web` profile；桌面端 provider 部分缺失属于启动失败，不是"用命令行改另一个 profile"的许可。

## 最小验证插件

`tests/fixtures/desktop-host-services-smoke-plugin/` 是一个两文件的 profile 本地插件：声明 `inject = ['desktopProfiles', 'desktopPnpm']`，读 `current`，确认两个方法可用，只把结果作为测试探针发布，不执行 pnpm。`corepack yarn verify:profile` 会把它复制进临时 profile 并以普通 Loader 行加载。
