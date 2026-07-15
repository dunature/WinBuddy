/**
 * VoiceInputSettings — 语音输入设置
 */

import * as React from 'react'
import { Copy, ExternalLink, Loader2, Mic, MicOff, Plus, TestTube2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ModelSelector } from '@/components/chat/ModelSelector'
import {
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSecretInput,
  SettingsSection,
  SettingsSelect,
  SettingsTextarea,
  SettingsToggle,
} from './primitives'
import type {
  MicPermissionResult,
  VoiceDictationSettings,
  VoiceDictionaryEntry,
  VoicePolishMode,
  VoiceStylePack,
} from '../../../types'
import type { ModelOption } from '@proma/shared'

const ENDPOINT_OPTIONS = [
  { value: 'async', label: '双向流式优化版' },
  { value: 'duplex', label: '双向流式标准版' },
]

const CONNECTION_MODE_OPTIONS = [
  { value: 'standard', label: '豆包流式语音识别' },
  { value: 'ark-agent-plan', label: '火山方舟 Agent Plan 语音大模型' },
]

const OUTPUT_OPTIONS = [
  { value: 'auto', label: '自动：Proma 激活时写入对话框，否则写入当前光标' },
  { value: 'clipboard', label: '仅复制到剪贴板' },
  { value: 'proma-input', label: '仅写入 Proma 输入框' },
]

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  { value: 'zh-CN', label: '中文普通话' },
  { value: 'en-US', label: '英语' },
  { value: 'yue-CN', label: '粤语' },
  { value: 'ja-JP', label: '日语' },
  { value: 'ko-KR', label: '韩语' },
]

const STYLE_MODE_OPTIONS = [
  { value: 'light', label: '轻度整理' },
  { value: 'structured', label: '结构化' },
  { value: 'formal', label: '正式表达' },
]

const VOLCENGINE_SPEECH_SERVICE_URL = 'https://console.volcengine.com/speech/service/'

function parseAliases(value: string): string[] {
  return value.split(/[\n,，、;；]+/u).map((item) => item.trim()).filter(Boolean)
}

function formatModel(settings: VoiceDictationSettings): { channelId: string; modelId: string } | null {
  if (!settings.polish.channelId || !settings.polish.modelId) return null
  return { channelId: settings.polish.channelId, modelId: settings.polish.modelId }
}

export function VoiceInputSettings(): React.ReactElement {
  const [settings, setSettings] = React.useState<VoiceDictationSettings | null>(null)
  const [stylePacks, setStylePacks] = React.useState<VoiceStylePack[]>([])
  const [dictionaryEntries, setDictionaryEntries] = React.useState<VoiceDictionaryEntry[]>([])
  const [selectedStyleId, setSelectedStyleId] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [micPermission, setMicPermission] = React.useState<MicPermissionResult | null>(null)
  const [requestingPermission, setRequestingPermission] = React.useState(false)
  const [newTerm, setNewTerm] = React.useState('')
  const [newAliases, setNewAliases] = React.useState('')
  const [newCategory, setNewCategory] = React.useState('')
  const [newDescription, setNewDescription] = React.useState('')

  const refreshStylePacks = React.useCallback(async () => {
    const packs = await window.electronAPI.listVoiceStylePacks()
    setStylePacks(packs)
    setSelectedStyleId((current) => current ?? packs[0]?.id ?? null)
  }, [])

  const refreshDictionary = React.useCallback(async () => {
    const entries = await window.electronAPI.listVoiceDictionaryEntries()
    setDictionaryEntries(entries)
  }, [])

  const refreshMicPermission = React.useCallback(async () => {
    try {
      const result = await window.electronAPI.checkMicrophonePermission()
      setMicPermission(result)
    } catch (error) {
      console.error('[语音输入] 检查麦克风权限失败:', error)
    }
  }, [])

  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getVoiceDictationSettings().then(setSettings),
      refreshStylePacks(),
      refreshDictionary(),
      refreshMicPermission(),
    ]).catch((error) => {
      console.error('[语音输入] 加载设置失败:', error)
      toast.error('加载语音输入设置失败')
    })
  }, [refreshDictionary, refreshMicPermission, refreshStylePacks])

  const update = React.useCallback(async (updates: Partial<VoiceDictationSettings>) => {
    if (!settings) return
    const optimistic: VoiceDictationSettings = {
      ...settings,
      ...updates,
      polish: {
        ...settings.polish,
        ...(updates.polish ?? {}),
      },
      provider: 'doubao',
    }
    setSettings(optimistic)
    setSaving(true)
    try {
      const saved = await window.electronAPI.updateVoiceDictationSettings(optimistic)
      setSettings(saved)
      window.electronAPI.reregisterGlobalShortcuts().catch(console.error)
    } catch (error) {
      console.error('[语音输入] 保存设置失败:', error)
      toast.error('保存语音输入设置失败')
    } finally {
      setSaving(false)
    }
  }, [settings])

  const handleRequestMicPermission = React.useCallback(async () => {
    setRequestingPermission(true)
    try {
      const result = await window.electronAPI.requestMicrophonePermission()
      setMicPermission(result)
      if (result.status === 'granted') {
        toast.success('麦克风权限已授权')
      } else if (result.status === 'denied') {
        toast.error('麦克风权限已被拒绝，请在系统设置中允许')
      }
    } catch (error) {
      console.error('[语音输入] 请求麦克风权限失败:', error)
      toast.error('请求麦克风权限失败')
    } finally {
      setRequestingPermission(false)
    }
  }, [])

  const handleTest = React.useCallback(async () => {
    if (!settings) return
    setTesting(true)
    try {
      const result = await window.electronAPI.testVoiceDictationConnection(settings)
      if (result.success) toast.success(result.message)
      else toast.error(result.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      toast.error(`测试连接失败: ${message}`)
    } finally {
      setTesting(false)
    }
  }, [settings])

  const handleModelSelect = React.useCallback((option: ModelOption) => {
    update({ polish: { ...settings!.polish, channelId: option.channelId, modelId: option.modelId } }).catch(console.error)
  }, [settings, update])

  const handleDuplicateStyle = React.useCallback(async (pack: VoiceStylePack) => {
    try {
      const created = await window.electronAPI.upsertVoiceStylePack({
        name: `${pack.name} 副本`,
        mode: pack.mode === 'raw' ? 'light' : pack.mode,
        description: pack.description,
        instruction: pack.instruction,
        examples: pack.examples,
      })
      await refreshStylePacks()
      setSelectedStyleId(created.id)
      toast.success('风格包已复制')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制风格包失败')
    }
  }, [refreshStylePacks])

  const handleCreateStyle = React.useCallback(async () => {
    try {
      const created = await window.electronAPI.upsertVoiceStylePack({
        name: '新风格包',
        mode: 'light',
        description: '',
        instruction: '轻度整理语音转写文本，修正明显错别字，保留原始语气和事实边界。',
        examples: [],
      })
      await refreshStylePacks()
      setSelectedStyleId(created.id)
      toast.success('风格包已创建')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建风格包失败')
    }
  }, [refreshStylePacks])

  const handleSaveStyle = React.useCallback(async (pack: VoiceStylePack, updates: Partial<VoiceStylePack>) => {
    if (pack.isBuiltin) return
    try {
      await window.electronAPI.upsertVoiceStylePack({
        id: pack.id,
        name: updates.name ?? pack.name,
        mode: (updates.mode ?? pack.mode) as VoicePolishMode,
        description: updates.description ?? pack.description,
        instruction: updates.instruction ?? pack.instruction,
        examples: updates.examples ?? pack.examples,
      })
      await refreshStylePacks()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存风格包失败')
    }
  }, [refreshStylePacks])

  const handleDeleteStyle = React.useCallback(async (pack: VoiceStylePack) => {
    if (pack.isBuiltin) return
    try {
      await window.electronAPI.deleteVoiceStylePack(pack.id)
      await refreshStylePacks()
      if (settings?.polish.stylePackId === pack.id) {
        await update({ polish: { ...settings.polish, stylePackId: 'builtin-light' } })
      }
      setSelectedStyleId('builtin-light')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除风格包失败')
    }
  }, [refreshStylePacks, settings, update])

  const handleAddDictionaryEntry = React.useCallback(async () => {
    if (!newTerm.trim()) return
    try {
      await window.electronAPI.upsertVoiceDictionaryEntry({
        term: newTerm,
        aliases: parseAliases(newAliases),
        category: newCategory.trim() || undefined,
        description: newDescription.trim() || undefined,
        enabled: true,
      })
      setNewTerm('')
      setNewAliases('')
      setNewCategory('')
      setNewDescription('')
      await refreshDictionary()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存词条失败')
    }
  }, [newAliases, newCategory, newDescription, newTerm, refreshDictionary])

  const handleToggleDictionaryEntry = React.useCallback(async (entry: VoiceDictionaryEntry, enabled: boolean) => {
    try {
      await window.electronAPI.upsertVoiceDictionaryEntry({
        id: entry.id,
        term: entry.term,
        aliases: entry.aliases,
        category: entry.category,
        description: entry.description,
        enabled,
      })
      await refreshDictionary()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新词条失败')
    }
  }, [refreshDictionary])

  const handleDeleteDictionaryEntry = React.useCallback(async (id: string) => {
    try {
      await window.electronAPI.deleteVoiceDictionaryEntry(id)
      await refreshDictionary()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除词条失败')
    }
  }, [refreshDictionary])

  if (!settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在加载语音输入设置...
      </div>
    )
  }

  const selectedStyle = stylePacks.find((pack) => pack.id === selectedStyleId) ?? stylePacks[0]
  const styleOptions = stylePacks.map((pack) => ({ value: pack.id, label: pack.name }))
  const enabledDictionaryCount = dictionaryEntries.filter((entry) => entry.enabled).length
  const isAgentPlan = settings.connectionMode === 'ark-agent-plan'
  const testDisabled = testing
    || !settings.resourceId
    || !settings.accessToken
    || (!isAgentPlan && !settings.appId)

  return (
    <div className="space-y-6">
      <SettingsSection
        title="豆包流式语音输入"
        description="通过全局快捷键唤起浮窗，实时识别语音，停止后写入 Proma 输入框或当前光标位置。"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testDisabled}
          >
            {testing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <TestTube2 className="mr-1.5 size-3.5" />}
            测试连接
          </Button>
        }
      >
        <div className="rounded-lg bg-muted/55 px-4 py-3 text-sm text-muted-foreground shadow-sm">
          <div className="mb-1.5 font-medium text-foreground">配置方式</div>
          <div className="space-y-1 leading-relaxed">
            <p>
              打开
              <a
                href={VOLCENGINE_SPEECH_SERVICE_URL}
                target="_blank"
                rel="noreferrer"
                className="mx-1 inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
              >
                火山引擎语音服务控制台
                <ExternalLink className="size-3" />
              </a>
              ，选择旧版服务界面。
            </p>
            <p>找到“豆包流式语音识别模型2.0”类目，选择已申请对应权限的应用。</p>
          </div>
        </div>

        {micPermission && (
          <div className="rounded-lg border px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                {micPermission.status === 'granted' ? (
                  <Mic className="size-4 shrink-0 text-green-500" />
                ) : micPermission.status === 'denied' ? (
                  <MicOff className="size-4 shrink-0 text-destructive" />
                ) : (
                  <Mic className="size-4 shrink-0 text-amber-500" />
                )}
                <div className="min-w-0">
                  <span className="font-medium text-foreground">麦克风权限</span>
                  <span className="ml-2 text-muted-foreground">
                    {micPermission.status === 'granted'
                      ? '已授权，语音输入可正常使用'
                      : micPermission.status === 'denied'
                        ? '已被系统阻止，请在系统设置中允许 Proma 访问麦克风'
                        : micPermission.status === 'not-determined'
                          ? '未授权，使用语音输入前需要先授权'
                          : '当前系统不支持预检，录音时将自动弹出权限请求'}
                  </span>
                </div>
              </div>
              {(micPermission.status === 'not-determined' || micPermission.status === 'denied') && (
                <Button variant="outline" size="sm" onClick={handleRequestMicPermission} disabled={requestingPermission}>
                  {requestingPermission ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Mic className="mr-1.5 size-3.5" />}
                  {micPermission.status === 'not-determined' ? '允许麦克风权限' : '重新请求权限'}
                </Button>
              )}
            </div>
          </div>
        )}

        <SettingsCard>
          <SettingsToggle
            label="启用语音输入"
            description="启用后可使用 Ctrl+～ 打开语音输入浮窗，再按一次停止。"
            checked={settings.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
          />
          <SettingsSelect
            label="连接方案"
            description="Agent Plan 使用火山方舟语音大模型 API Key；普通方案保留现有 APP ID 和 Access Token。"
            value={settings.connectionMode}
            onValueChange={(connectionMode) => update({
              connectionMode: connectionMode as VoiceDictationSettings['connectionMode'],
              endpointMode: connectionMode === 'ark-agent-plan' ? 'async' : settings.endpointMode,
            })}
            options={CONNECTION_MODE_OPTIONS}
          />
          <SettingsInput
            label="豆包 APP ID"
            description="普通豆包 ASR 需要，对应 X-Api-App-Key；Agent Plan 不需要填写。"
            value={settings.appId}
            onChange={(appId) => update({ appId })}
            placeholder="请输入 APP ID"
            disabled={isAgentPlan}
          />
          <SettingsSecretInput
            label={isAgentPlan ? 'Agent Plan API Key' : '豆包 Access Token'}
            description={isAgentPlan ? '对应 X-Api-Key，保存时会加密。' : '对应 X-Api-Access-Key，保存时会加密。'}
            value={settings.accessToken}
            onChange={(accessToken) => update({ accessToken })}
            placeholder={isAgentPlan ? '请输入 Agent Plan API Key' : '请输入 Access Token'}
          />
          <SettingsInput
            label="Resource ID"
            description="默认使用火山语音大模型小时版资源 ID。"
            value={settings.resourceId}
            onChange={(resourceId) => update({ resourceId })}
            placeholder="volc.seedasr.sauc.duration"
          />
          <SettingsSelect
            label="连接模式"
            description={isAgentPlan ? 'Agent Plan 当前使用异步优化版端点。' : '优化版只在结果变化时返回新包，实时体验更好。'}
            value={settings.endpointMode}
            onValueChange={(endpointMode) => update({ endpointMode: endpointMode as VoiceDictationSettings['endpointMode'] })}
            options={ENDPOINT_OPTIONS}
            disabled={isAgentPlan}
          />
          <SettingsSelect
            label="识别语言"
            description="自动识别适合中英文和方言混合输入。"
            value={settings.language || 'auto'}
            onValueChange={(language) => update({ language: language === 'auto' ? '' : language })}
            options={LANGUAGE_OPTIONS}
          />
          <SettingsSelect
            label="输出方式"
            description="默认写入当前光标位置；如果唤起时 Proma 是当前激活窗口，会写入当前 Chat 或 Agent 输入框。"
            value={settings.outputMode}
            onValueChange={(outputMode) => update({ outputMode: outputMode as VoiceDictationSettings['outputMode'] })}
            options={OUTPUT_OPTIONS}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="智能整理" description="ASR 完成后调用一次已配置模型整理文本；默认关闭，Raw 风格不会调用模型。">
        <SettingsCard>
          <SettingsToggle
            label="启用智能整理"
            description="开启后，完整转写会先经过 LLM 整理，再提交到目标输入位置。"
            checked={settings.polish.enabled}
            onCheckedChange={(enabled) => update({ polish: { ...settings.polish, enabled } })}
          />
          <SettingsRow label="整理模型" description="复用已配置的渠道和模型；凭证仍由渠道系统加密管理。">
            <ModelSelector
              externalSelectedModel={formatModel(settings)}
              onModelSelect={handleModelSelect}
              showChannelInTrigger
            />
          </SettingsRow>
          <SettingsSelect
            label="当前风格包"
            description="Raw 会直接提交原文；其他风格会执行一次模型整理。"
            value={settings.polish.stylePackId}
            onValueChange={(stylePackId) => update({ polish: { ...settings.polish, stylePackId } })}
            options={styleOptions}
          />
          <SettingsToggle
            label="提交前预览"
            description="开启后，整理完成先显示只读预览，可选择整理结果、原文或取消。"
            checked={settings.polish.previewBeforeCommit}
            onCheckedChange={(previewBeforeCommit) => update({ polish: { ...settings.polish, previewBeforeCommit } })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="风格包"
        description="内置风格包只读，可复制后编辑。每个自定义风格最多保留 3 组 few-shot 示例。"
        action={(
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCreateStyle}>
              <Plus className="mr-1.5 size-3.5" />
              新建
            </Button>
            {selectedStyle && (
              <Button variant="outline" size="sm" onClick={() => handleDuplicateStyle(selectedStyle)}>
                <Copy className="mr-1.5 size-3.5" />
                复制
              </Button>
            )}
          </div>
        )}
      >
        <SettingsCard>
          <SettingsSelect
            label="编辑风格包"
            value={selectedStyleId ?? ''}
            onValueChange={setSelectedStyleId}
            options={styleOptions}
          />
          {selectedStyle && (
            <div className="space-y-0">
              <SettingsInput
                label="名称"
                value={selectedStyle.name}
                onChange={(name) => handleSaveStyle(selectedStyle, { name })}
                disabled={selectedStyle.isBuiltin}
              />
              <SettingsSelect
                label="语义"
                value={selectedStyle.mode === 'raw' ? 'light' : selectedStyle.mode}
                onValueChange={(mode) => handleSaveStyle(selectedStyle, { mode: mode as VoicePolishMode })}
                options={STYLE_MODE_OPTIONS}
                disabled={selectedStyle.isBuiltin}
              />
              <SettingsTextarea
                label="说明"
                value={selectedStyle.description}
                onChange={(description) => handleSaveStyle(selectedStyle, { description })}
                disabled={selectedStyle.isBuiltin}
                minHeight={64}
              />
              <SettingsTextarea
                label="整理指令"
                value={selectedStyle.instruction}
                onChange={(instruction) => handleSaveStyle(selectedStyle, { instruction })}
                disabled={selectedStyle.isBuiltin}
                minHeight={120}
              />
              {!selectedStyle.isBuiltin && (
                <div className="px-4 py-3">
                  <Button variant="destructive" size="sm" onClick={() => handleDeleteStyle(selectedStyle)}>
                    <Trash2 className="mr-1.5 size-3.5" />
                    删除风格包
                  </Button>
                </div>
              )}
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="结构化词典" description={`启用词条会同时用于 ASR 热词和 LLM 术语纠偏。当前启用 ${enabledDictionaryCount}/100 条。`}>
        <SettingsCard divided={false} className="p-0">
          <div className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_0.75fr_auto]">
            <input
              value={newTerm}
              onChange={(event) => setNewTerm(event.target.value)}
              placeholder="规范术语"
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              value={newAliases}
              onChange={(event) => setNewAliases(event.target.value)}
              placeholder="别名，可逗号分隔"
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
              placeholder="分类"
              className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button size="sm" onClick={handleAddDictionaryEntry} disabled={!newTerm.trim()}>
              <Plus className="mr-1.5 size-3.5" />
              添加
            </Button>
          </div>
          <div className="px-4 pb-4">
            <input
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              placeholder="说明，例如品牌、项目、专有名词的正确含义"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="divide-y divide-border/60">
            {dictionaryEntries.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">暂无词条</div>
            ) : dictionaryEntries.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  onChange={(event) => handleToggleDictionaryEntry(entry, event.target.checked)}
                  className="size-4"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{entry.term}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {entry.aliases.length > 0 ? `别名：${entry.aliases.join('、')}` : '无别名'}
                  </div>
                  {(entry.category || entry.description) && (
                    <div className="truncate text-xs text-muted-foreground">
                      {[entry.category, entry.description].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => handleDeleteDictionaryEntry(entry.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </SettingsCard>
      </SettingsSection>

      {saving && <p className="text-xs text-muted-foreground">正在保存语音输入设置...</p>}
    </div>
  )
}
