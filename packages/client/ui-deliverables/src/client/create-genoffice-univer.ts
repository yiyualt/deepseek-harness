/** Free Univer preset composition used by the embedded GenOffice sheet editor. */

import { LogLevel, Univer } from '@univerjs/core'
import type { DependencyOverride, IUniverConfig, Plugin, PluginCtor } from '@univerjs/core'
import { FUniver } from '@univerjs/core/lib/facade'

type PluginEntry = PluginCtor<Plugin> | [PluginCtor<Plugin>, ConstructorParameters<PluginCtor<Plugin>>[0]]

/** Free Univer plugins and their default configurations. */
export interface GenOfficeUniverPreset {
  plugins: PluginEntry[]
}

/** Options accepted by the GenOffice copy of Univer's preset composer. */
export interface GenOfficeUniverOptions extends Partial<IUniverConfig> {
  presets: Array<GenOfficeUniverPreset | [GenOfficeUniverPreset, { lazy?: boolean }]>
  plugins?: PluginEntry[]
  override?: DependencyOverride
}

/**
 * Compose free Univer sheet presets without the proprietary preset meta-package.
 * @param options Univer configuration and free preset list.
 * @returns Runtime and facade used by the embedded grid.
 */
export function createGenOfficeUniver(
  options: GenOfficeUniverOptions,
): { univer: Univer; univerAPI: FUniver } {
  const { presets, plugins, override = [], ...univerConfig } = options
  const univer = new Univer({ logLevel: LogLevel.WARN, ...univerConfig, override })
  const registry = new Map<string, { plugin: PluginCtor<Plugin>; options: unknown }>()
  for (const entry of presets) {
    const preset = Array.isArray(entry) ? entry[0] : entry
    for (const pluginEntry of preset.plugins) {
      const [plugin, pluginOptions] = Array.isArray(pluginEntry)
        ? pluginEntry
        : [pluginEntry, undefined]
      registry.delete(plugin.pluginName)
      registry.set(plugin.pluginName, { plugin, options: pluginOptions })
    }
  }
  for (const pluginEntry of plugins ?? []) {
    const [plugin, pluginOptions] = Array.isArray(pluginEntry)
      ? pluginEntry
      : [pluginEntry, undefined]
    if (registry.has(plugin.pluginName)) {
      throw new Error(`Univer plugin is already registered: ${plugin.pluginName}`)
    }
    registry.set(plugin.pluginName, { plugin, options: pluginOptions })
  }
  for (const { plugin, options: pluginOptions } of registry.values()) {
    univer.registerPlugin(plugin, pluginOptions)
  }
  return { univer, univerAPI: FUniver.newAPI(univer) }
}
