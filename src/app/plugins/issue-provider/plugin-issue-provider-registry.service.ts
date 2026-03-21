import { Injectable } from '@angular/core';
import {
  RegisteredPluginIssueProvider,
  IssueProviderPluginDefinition,
  PluginIssueField,
  PluginCommentsConfig,
  PluginFieldMapping,
} from './plugin-issue-provider.model';
import { IssueProviderKey } from '../../features/issue/issue.model';

@Injectable({ providedIn: 'root' })
export class PluginIssueProviderRegistryService {
  private _providers = new Map<string, RegisteredPluginIssueProvider>();

  /** Maps pluginId → registeredKey for cleanup */
  private _pluginIdToKey = new Map<string, string>();

  register(opts: {
    pluginId: string;
    definition: IssueProviderPluginDefinition;
    name: string;
    icon: string;
    pollIntervalMs: number;
    issueStrings: { singular: string; plural: string };
    issueProviderKey?: string;
    useAgendaView?: boolean;
    defaultAutoAddToBacklog?: boolean;
  }): void {
    const key = opts.issueProviderKey ?? `plugin:${opts.pluginId}`;
    if (this._providers.has(key)) {
      console.warn(
        `[PluginIssueProviderRegistry] Duplicate registration for '${key}', ignoring.`,
      );
      return;
    }
    this._providers.set(key, {
      pluginId: opts.pluginId,
      registeredKey: key as IssueProviderKey,
      definition: opts.definition,
      name: opts.name,
      icon: opts.icon,
      pollIntervalMs: opts.pollIntervalMs,
      issueStrings: opts.issueStrings,
      useAgendaView: opts.useAgendaView,
      defaultAutoAddToBacklog: opts.defaultAutoAddToBacklog,
    });
    this._pluginIdToKey.set(opts.pluginId, key);
  }

  unregister(pluginId: string): void {
    const key = this._pluginIdToKey.get(pluginId);
    if (key) {
      this._providers.delete(key);
      this._pluginIdToKey.delete(pluginId);
    }
  }

  /** Get the registered key for a pluginId (e.g. 'GITHUB' or 'plugin:my-plugin') */
  getRegisteredKey(pluginId: string): string | undefined {
    return this._pluginIdToKey.get(pluginId);
  }

  getProvider(key: string): RegisteredPluginIssueProvider | undefined {
    return this._providers.get(key);
  }

  hasProvider(key: string): boolean {
    return this._providers.has(key);
  }

  getAvailableProviders(): RegisteredPluginIssueProvider[] {
    return Array.from(this._providers.values());
  }

  getIcon(key: string): string {
    return this._providers.get(key)?.icon ?? 'extension';
  }

  getName(key: string): string {
    return this._providers.get(key)?.name ?? 'Plugin';
  }

  getIssueStrings(key: string): {
    ISSUE_STR: string;
    ISSUES_STR: string;
  } {
    const p = this._providers.get(key);
    return {
      ISSUE_STR: p?.issueStrings.singular ?? 'Issue',
      ISSUES_STR: p?.issueStrings.plural ?? 'Issues',
    };
  }

  getPollIntervalMs(key: string): number {
    return this._providers.get(key)?.pollIntervalMs ?? 0;
  }

  getIssueDisplay(key: string): PluginIssueField[] {
    return this._providers.get(key)?.definition.issueDisplay ?? [];
  }

  getConfigFields(key: string): IssueProviderPluginDefinition['configFields'] {
    return this._providers.get(key)?.definition.configFields ?? [];
  }

  getCommentsConfig(key: string): PluginCommentsConfig | undefined {
    return this._providers.get(key)?.definition.commentsConfig;
  }

  getFieldMappings(key: string): PluginFieldMapping[] | undefined {
    return this._providers.get(key)?.definition.fieldMappings;
  }

  getUseAgendaView(key: string): boolean {
    return this._providers.get(key)?.useAgendaView ?? false;
  }
}
