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

## 个性化人物（`persona`）

`gala.json` 可带可选的 `persona` 字段（内部字段名保留 `persona`），让模型在换上该角色时用她的语气回答（详见 `dsh-plugin-gala/src/gala-persona.ts`）。该功能默认关闭，用户需在“设置 → 插件 → 角色空间”或换肤弹层里开启：

```json
{
  "persona": {
    "archetype": "嘴硬心软的傲娇天才少女",
    "story": "两到四句背景故事，会出现在图鉴详情与下载站。",
    "voice": ["逐条说话风格规则，给模型看", "……"],
    "catchphrases": ["口头禅", "代表台词"],
    "selfReference": "本天才",
    "addressUser": "你"
  }
}
```

- 长度上限见 `PERSONA_LIMITS`（archetype ≤ 32，story ≤ 400，voice ≤ 8 × 120，catchphrases ≤ 6 × 64）。
- 人物提示词以 `gala:persona` 段落（order 1）注册进 `ctx.systemPrompt`，段落文本每次组装时实时解析当前皮肤与开关，因此换肤与开关即时生效；开关默认关闭（`gala-persona.ts` 的 `DEFAULT_ENABLED`），关闭态段落为空串、不注入。
- 全员群星不带人物设定；没有 `persona` 的自定义角色会按 `description` 生成轻量包装；经典配色与原装不注入任何段落。
- 提示词固定附带底线：只改语气不改能力、代码 / 命令 / 事实保持准确、用户要求“正经一点”立即切换、不假装人类。

## 皮肤的过程文字 token（自动推导）

`gala-skin-map.ts` 除了把 `--gala-color-*` 映射到对应的 `--dsw-*` 之外，还会从 `--gala-color-primary` 的色相推导一组“过程文字”token：`--dsw-alias-label-secondary / -tertiary / -caption / -quaternary` 与 `--dsw-alias-separator-primary`。原因是上游默认的中性灰（caption `#adb2b8`）在角色皮肤的浅色底上只有约 2.4:1 的对比度，工具调用、上下文注入、规则、思考、时间戳这些行几乎看不清。推导值带主题色相，并按对比度收敛：light 值相对皮肤的 `--gala-color-bg` 逐步压暗、dark 值相对推导后的深色底逐步提亮，直到 secondary ≥ 7.5:1、tertiary ≥ 5:1、caption ≥ 3.8:1（quaternary ≥ 2.6、separator ≥ 1.5），暖色与冷色主题都能稳定达到同一可读性；测试逐套皮肤校验。皮肤包不需要也不能直接声明这些 token；主色不是 hex 时不推导，保持官方默认。
