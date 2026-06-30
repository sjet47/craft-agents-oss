/**
 * AgentContextSettingsPage
 *
 * Configures auto-injection of context files into the system prompt.
 * Two settings, each a toggle + a path input:
 *   1. Global context  — injected across all projects (default ~/.agents/AGENTS.md)
 *   2. Project context — injected for the session working directory (default AGENTS.md)
 *
 * The file CONTENT is injected directly into the system prompt (the way
 * Claude Code / Codex treat CLAUDE.md / AGENTS.md). Auto-saves to
 * ~/.craft-agent/preferences.json with debouncing, preserving unrelated fields.
 */

import * as React from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { routes } from '@/lib/navigate'
import { Spinner } from '@craft-agent/ui'
import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
  SettingsInput,
} from '@/components/settings'
import {
  DEFAULT_AGENT_CONTEXT_GLOBAL_PATH,
  DEFAULT_AGENT_CONTEXT_PROJECT_PATH,
} from '@craft-agent/shared/config/agent-context-defaults'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'agent-context',
}

interface AgentContextFormState {
  globalEnabled: boolean
  globalPath: string
  projectEnabled: boolean
  projectPath: string
  skillsEnabled: boolean
}

const defaultFormState: AgentContextFormState = {
  globalEnabled: true,
  globalPath: DEFAULT_AGENT_CONTEXT_GLOBAL_PATH,
  projectEnabled: true,
  projectPath: DEFAULT_AGENT_CONTEXT_PROJECT_PATH,
  skillsEnabled: true,
}

// Parse preferences JSON into form state, applying default-on semantics:
// `undefined` enabled is treated as TRUE; empty/undefined path falls back to
// the shared default path constant.
function parseAgentContext(json: string): AgentContextFormState {
  try {
    const prefs = JSON.parse(json)
    return {
      globalEnabled: prefs.agentContextGlobalEnabled !== false,
      globalPath: prefs.agentContextGlobalPath || DEFAULT_AGENT_CONTEXT_GLOBAL_PATH,
      projectEnabled: prefs.agentContextProjectEnabled !== false,
      projectPath: prefs.agentContextProjectPath || DEFAULT_AGENT_CONTEXT_PROJECT_PATH,
      skillsEnabled: prefs.agentContextSkillsEnabled !== false,
    }
  } catch {
    return defaultFormState
  }
}

// Merge form state into the existing preferences object so unrelated fields
// (name, timezone, notes, …) are preserved on write.
function serializeAgentContext(json: string, state: AgentContextFormState): string {
  let prefs: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed === 'object') prefs = parsed
  } catch {
    prefs = {}
  }

  prefs.agentContextGlobalEnabled = state.globalEnabled
  prefs.agentContextGlobalPath = state.globalPath
  prefs.agentContextProjectEnabled = state.projectEnabled
  prefs.agentContextProjectPath = state.projectPath
  prefs.agentContextSkillsEnabled = state.skillsEnabled
  prefs.updatedAt = Date.now()

  return JSON.stringify(prefs, null, 2)
}

export default function AgentContextSettingsPage() {
  const { t } = useTranslation()
  const [formState, setFormState] = useState<AgentContextFormState>(defaultFormState)
  const [isLoading, setIsLoading] = useState(true)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitialLoadRef = useRef(true)
  // Raw preferences JSON last read from disk — merged on save to preserve
  // unrelated fields.
  const rawPrefsRef = useRef<string>('{}')
  const formStateRef = useRef(formState)
  const lastSavedRef = useRef<string | null>(null)

  useEffect(() => {
    formStateRef.current = formState
  }, [formState])

  // Load stored preferences on mount
  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.electronAPI.readPreferences()
        rawPrefsRef.current = result.content
        const parsed = parseAgentContext(result.content)
        setFormState(parsed)
        lastSavedRef.current = serializeAgentContext(result.content, parsed)
      } catch (err) {
        console.error('Failed to load preferences:', err)
        setFormState(defaultFormState)
      } finally {
        setIsLoading(false)
        setTimeout(() => {
          isInitialLoadRef.current = false
        }, 100)
      }
    }
    load()
  }, [])

  // Auto-save with debouncing
  useEffect(() => {
    if (isInitialLoadRef.current || isLoading) return

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const json = serializeAgentContext(rawPrefsRef.current, formState)
        const result = await window.electronAPI.writePreferences(json)
        if (result.success) {
          rawPrefsRef.current = json
          lastSavedRef.current = json
        } else {
          console.error('Failed to save preferences:', result.error)
        }
      } catch (err) {
        console.error('Failed to save preferences:', err)
      }
    }, 500)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [formState, isLoading])

  // Force save on unmount if there are unsaved changes
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      const currentJson = serializeAgentContext(rawPrefsRef.current, formStateRef.current)
      if (lastSavedRef.current !== currentJson && !isInitialLoadRef.current) {
        window.electronAPI.writePreferences(currentJson).catch((err) => {
          console.error('Failed to save preferences on unmount:', err)
        })
      }
    }
  }, [])

  const updateField = useCallback(<K extends keyof AgentContextFormState>(
    field: K,
    value: AgentContextFormState[K]
  ) => {
    setFormState(prev => ({ ...prev, [field]: value }))
  }, [])

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner className="text-lg text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        title={t("settings.agentContext.title")}
        actions={<HeaderMenu route={routes.view.settings('agent-context')} />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto space-y-8">
            {/* Global context */}
            <SettingsSection
              title={t("settings.agentContext.global")}
              description={t("settings.agentContext.globalDesc")}
            >
              <SettingsCard divided>
                <SettingsToggle
                  label={t("settings.agentContext.globalToggle")}
                  description={t("settings.agentContext.globalToggleDesc")}
                  checked={formState.globalEnabled}
                  onCheckedChange={(v) => updateField('globalEnabled', v)}
                />
                <SettingsInput
                  label={t("settings.agentContext.globalPath")}
                  description={t("settings.agentContext.globalPathDesc")}
                  value={formState.globalPath}
                  onChange={(v) => updateField('globalPath', v)}
                  placeholder={DEFAULT_AGENT_CONTEXT_GLOBAL_PATH}
                  inCard
                />
              </SettingsCard>
            </SettingsSection>

            {/* Project context */}
            <SettingsSection
              title={t("settings.agentContext.project")}
              description={t("settings.agentContext.projectDesc")}
            >
              <SettingsCard divided>
                <SettingsToggle
                  label={t("settings.agentContext.projectToggle")}
                  description={t("settings.agentContext.projectToggleDesc")}
                  checked={formState.projectEnabled}
                  onCheckedChange={(v) => updateField('projectEnabled', v)}
                />
                <SettingsInput
                  label={t("settings.agentContext.projectPath")}
                  description={t("settings.agentContext.projectPathDesc")}
                  value={formState.projectPath}
                  onChange={(v) => updateField('projectPath', v)}
                  placeholder={DEFAULT_AGENT_CONTEXT_PROJECT_PATH}
                  inCard
                />
              </SettingsCard>
            </SettingsSection>

            {/* Skills catalog */}
            <SettingsSection
              title={t("settings.agentContext.skills")}
              description={t("settings.agentContext.skillsDesc")}
            >
              <SettingsCard>
                <SettingsToggle
                  label={t("settings.agentContext.skillsToggle")}
                  description={t("settings.agentContext.skillsToggleDesc")}
                  checked={formState.skillsEnabled}
                  onCheckedChange={(v) => updateField('skillsEnabled', v)}
                />
              </SettingsCard>
            </SettingsSection>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
