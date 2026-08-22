# 插件开发

桌面端不另起一套插件系统。一个普通的 DeepSeek Harness 插件——Host service、命令、路由、Web 客户端——在桌面端里原样可用。本文只讲桌面端额外提供的两个 Host service，以及怎样写出既能在桌面端、也能在普通 `dsh web` 里运行的插件。

## 桌面端多给了什么

| service | 用途 |
| --- | --- |
| `desktopProfiles` | 读当前 profile 的名字与目录；列出可选 profile；请求切换（通过重启生效） |
| `desktopPnpm` | 在当前 profile 里运行内置 pnpm，或以官方 `dsh plugin` 语义安装/卸载/更新插件 |

两者都运行在 Electron main 进程的 Host 里。渲染进程拿不到它们；带界面的插件照常用 DSH 的路由、RPC 与 slot。完整类型与失败语义见 [桌面 service 参考](../dsh-plugin-desktop/docs/plugin-services.md)。

## 只在桌面端运行的插件

把两个 service 写进 `inject`，Cordis 会等它们就绪后再激活插件：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from 'dsh-plugin-desktop/profile-service'
import type { DesktopPnpmHandle } from 'dsh-plugin-desktop/pnpm'

export const name = 'my-desktop-plugin'
export const inject = ['desktopProfiles', 'desktopPnpm']

export function apply(ctx: Context): void {
  ctx.logger.info(`running in profile ${ctx.desktopProfiles.current.name}`)

  let running: DesktopPnpmHandle | undefined
  async function install(target: string): Promise<void> {
    running = ctx.desktopPnpm.runPlugin(['add', target], process.cwd(), AbortSignal.timeout(5 * 60_000))
    const { exitCode, signal } = await running.done
    if (exitCode !== 0) throw new Error(`install failed: exit=${exitCode} signal=${signal}`)
  }

  ctx.effect(() => async () => {
    running?.cancel()
    await running?.done.catch(() => {})
  }, 'my-desktop-plugin: cancel pending install on unload')
}
```

要点：包操作必须由明确的用户动作触发；先校验 `target`；自己设超时；同时检查 `exitCode` 和 `signal`；一代 Host 同时只能有一个包操作，插件卸载时要取消并等待它结束。

## 同时兼容普通 DSH 的插件

不要把桌面 service 放进顶层 `inject`。先注入普通依赖，再在回调里探测：

```ts
export const inject = ['webServer', 'loader']

export function apply(ctx: Context, config: { profile?: string }): void {
  const profiles = ctx.get('desktopProfiles')
  if (profiles === undefined) {
    mountForPlainDsh(ctx, config.profile ?? 'web')
    return
  }
  ctx.inject(['desktopPnpm'], (desktopCtx) => {
    mountForDesktop(desktopCtx, {
      profile: profiles.current.name,
      profileDir: profiles.current.dir,
      runPlugin: (args, cwd, signal) => desktopCtx.desktopPnpm.runPlugin(args, cwd, signal),
    })
  })
}
```

`desktopProfiles` 存在就说明在桌面端，此时以 `desktopProfiles.current` 为准，不要再从 `process.argv`、settings、`$DSH_HOME` 猜 profile。

## `run` 与 `runPlugin`

- `desktopPnpm.run(args)`：直接跑内置 pnpm，cwd 是当前 profile 目录。不负责 profile 初始化、`file:`/`link:` 相对路径锚定，也不会在成功后同步 `dsh.profile.bundles`。
- `desktopPnpm.runPlugin(args, invokingDir)`：跑打包的 `dsh plugin --profile <当前>`，保留官方插件管理的全部语义。安装、卸载、更新、修依赖都用它。

参数始终是 argv 数组，不拼 shell 字符串；Windows 下也不需要找 `.cmd`。

## 别依赖的东西

`desktopRuntime`、`desktopPnpmBootstrap`、`galaHost`、Electron 的 `BrowserWindow`、托盘注册表、私有 Node shim、`ELECTRON_RUN_AS_NODE`——这些是桌面端内部实现，类型声明里能看到不代表可以用。

## 给 Gala 写扩展

Gala 的角色与皮肤是数据而非代码：`.ggal` 包就是一个 zip，内含 `manifest.json`、`gala.json`（或 `skin.json`）和资产目录。协议的 JSON Schema 在 `dsh-plugin-gala/src/protocols/`，打包工具在 `dsh-plugin-gala/scripts/build-gala-packs.ts`。导入后的包放在用户数据目录，不会写进仓库。

## 测试清单

- 普通 DSH 里没有桌面 service 时能加载（或按设计保持 pending）。
- 桌面端里读到的 profile 与用户实际选择一致。
- 包操作的取消、非零退出、spawn 失败、整代销毁时的清理。
- 插件变更后重启，bundle 进入下一代 Loader。
