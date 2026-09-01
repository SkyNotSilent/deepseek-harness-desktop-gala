/** Profile-local plugin compiled against the settings helpers removed by alpha.2. */

import {
  deepEqualJson,
  installSettingsSection,
  settingsNamespace,
} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-legacy-settings-smoke-plugin'

export function apply(ctx) {
  const namespace = settingsNamespace('legacy-settings-smoke')
  const schema = z.object({ enabled: z.boolean().default(true) })
  let current = () => ({ enabled: true })
  let changes = 0
  installSettingsSection(ctx, namespace, schema, { enabled: true }, {
    setSource(next) { current = next },
    onChange() { changes += 1 },
  })
  ctx.provide('legacySettingsProbe', Object.freeze({
    namespace,
    current: () => current(),
    changes: () => changes,
    equal: deepEqualJson({ nested: [1, true] }, { nested: [1, true] }),
  }))
}
