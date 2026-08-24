import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  GalaPersonaCard,
  GalaWorkspaceBrief,
  GalaWorkspaceExplainer,
  PERSONA_CARD_COPY,
  WORKSPACE_DISABLE_EXPLAINER,
  WORKSPACE_EXPLAINER,
} from '../src/client/GalaWorkspaceExplainer.tsx'
import { parsePickerData, personaStatusLine } from '../src/client/GalaSkinDock.tsx'

const noop = () => {}

describe('角色独立空间说明卡', () => {
  it('开启前摊开作用、共享边界、代价风险与适用人群，并提供确认 / 取消', () => {
    const html = renderToStaticMarkup(createElement(GalaWorkspaceExplainer, {
      mode: 'enable', busy: false, activeWorkspaceName: null, onConfirm: noop, onCancel: noop,
    }))
    expect(html).toContain(WORKSPACE_EXPLAINER.title)
    for (const item of [...WORKSPACE_EXPLAINER.does, ...WORKSPACE_EXPLAINER.shares, ...WORKSPACE_EXPLAINER.costs]) {
      expect(html).toContain(item)
    }
    expect(html).toContain('重启应用')
    expect(html).toContain('API Key')
    expect(html).toContain('默认关闭')
    expect(html).toContain(WORKSPACE_EXPLAINER.suits)
    expect(html).toContain(WORKSPACE_EXPLAINER.confirm)
    expect(html).toContain(WORKSPACE_EXPLAINER.cancel)
  })

  it('关闭前提示回到公共空间、数据保留，并在角色工作台内提示重启', () => {
    const shared = renderToStaticMarkup(createElement(GalaWorkspaceExplainer, {
      mode: 'disable', busy: false, activeWorkspaceName: null, onConfirm: noop, onCancel: noop,
    }))
    expect(shared).toContain(WORKSPACE_DISABLE_EXPLAINER.title)
    expect(shared).not.toContain('重启应用')
    const inRole = renderToStaticMarkup(createElement(GalaWorkspaceExplainer, {
      mode: 'disable', busy: true, activeWorkspaceName: '灵灵', onConfirm: noop, onCancel: noop,
    }))
    expect(inRole).toContain(WORKSPACE_DISABLE_EXPLAINER.restartNote('灵灵'))
    expect(inRole).toContain('处理中…')
    expect(inRole).toContain('disabled=""')
  })

  it('设置页常驻折叠说明包含同一份文案', () => {
    const html = renderToStaticMarkup(createElement(GalaWorkspaceBrief))
    expect(html).toContain('<details')
    expect(html).toContain(WORKSPACE_EXPLAINER.costs[0])
  })
})

describe('人设卡', () => {
  const profile = {
    characterId: 'gala:dsh-agent', name: '阿念', archetype: '嘴硬心软的傲娇天才少女',
    story: '阿念是公认的天才。', catchphrases: ['让我想想……有了！', '哼。'], authored: true,
  }

  it('开启且有角色时显示原型、故事与口头禅', () => {
    const html = renderToStaticMarkup(createElement(GalaPersonaCard, { enabled: true, profile, busy: false, onToggle: noop }))
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('阿念')
    expect(html).toContain(profile.archetype)
    expect(html).toContain(profile.story)
    expect(html).toContain('「让我想想……有了！」「哼。」')
    expect(html).not.toContain(PERSONA_CARD_COPY.fallback)
  })

  it('无人设 / 已关闭 / 自定义轻量人设分别给出说明', () => {
    const none = renderToStaticMarkup(createElement(GalaPersonaCard, { enabled: true, profile: null, busy: false, onToggle: noop }))
    expect(none).toContain(PERSONA_CARD_COPY.none)
    const off = renderToStaticMarkup(createElement(GalaPersonaCard, { enabled: false, profile, busy: false, onToggle: noop }))
    expect(off).toContain(PERSONA_CARD_COPY.disabled)
    expect(off).toContain('aria-checked="false"')
    expect(off).not.toContain(profile.story)
    const custom = renderToStaticMarkup(createElement(GalaPersonaCard, { enabled: true, profile: { ...profile, authored: false }, busy: false, onToggle: noop }))
    expect(custom).toContain(PERSONA_CARD_COPY.fallback)
  })
})

describe('picker 数据解析', () => {
  it('读取人设开关、当前人设与每位角色的原型；缺字段时安全降级', () => {
    const parsed = parsePickerData({
      picker: {
        girls: [{ skinId: 's', characterId: 'c', name: '阿念', archetype: '傲娇' }, { skinId: 't', characterId: 'd', name: '群星' }],
        classics: [],
        personaEnabled: false,
        activePersona: { characterId: 'c', name: '阿念', archetype: '傲娇', story: 'x', catchphrases: ['a', 1], authored: true },
      },
    })
    expect(parsed?.personaEnabled).toBe(false)
    expect(parsed?.activePersona).toEqual({ characterId: 'c', name: '阿念', archetype: '傲娇', story: 'x', catchphrases: ['a'], authored: true })
    expect(parsed?.girls.map(girl => girl.archetype)).toEqual(['傲娇', ''])
    const legacy = parsePickerData({ picker: { girls: [], classics: [] } })
    expect(legacy?.personaEnabled).toBe(false)
    expect(legacy?.activePersona).toBeNull()
  })

  it('personaStatusLine 覆盖未开启 / 开启有人物 / 开启无人物三种分支', () => {
    const profile = {
      characterId: 'c', name: '阿念', archetype: '傲娇', story: 'x', catchphrases: [], authored: true,
    }
    expect(personaStatusLine({ personaEnabled: false, activePersona: profile })).toBe('个性化人物未开启（默认关闭）')
    expect(personaStatusLine({ personaEnabled: true, activePersona: profile })).toBe('个性化人物：阿念 · 傲娇')
    expect(personaStatusLine({ personaEnabled: true, activePersona: null })).toBe('个性化人物：当前外观无可用人物')
  })
})
