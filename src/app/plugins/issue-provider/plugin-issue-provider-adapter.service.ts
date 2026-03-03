import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  IssueData,
  IssueDataReduced,
  IssueIntegrationCfg,
  IssueProviderPluginType,
  SearchResultItem,
} from '../../features/issue/issue.model';
import { PluginIssue } from './plugin-issue-provider.model';
import { IssueServiceInterface } from '../../features/issue/issue-service-interface';
import { IssueTask, Task } from '../../features/tasks/task.model';
import { PluginIssueProviderRegistryService } from './plugin-issue-provider-registry.service';
import { PluginHttpService } from './plugin-http.service';
import { PluginHttp, RegisteredPluginIssueProvider } from './plugin-issue-provider.model';
import { selectIssueProviderById } from '../../features/issue/store/issue-provider.selectors';
import { firstValueFrom } from 'rxjs';
import { SnackService } from '../../core/snack/snack.service';

@Injectable({ providedIn: 'root' })
export class PluginIssueProviderAdapterService implements IssueServiceInterface {
  private _registry = inject(PluginIssueProviderRegistryService);
  private _pluginHttp = inject(PluginHttpService);
  private _store = inject(Store);
  private _snackService = inject(SnackService);

  // Not meaningful for a multi-plugin adapter, but required by interface
  pollInterval = 0;

  isEnabled(): boolean {
    return true;
  }

  async testConnection(cfg: IssueIntegrationCfg): Promise<boolean> {
    const pluginCfg = this._asPluginCfg(cfg);
    if (!pluginCfg) {
      return false;
    }
    const resolved = this._resolve(pluginCfg);
    if (!resolved) {
      return false;
    }
    const { provider, http } = resolved;
    if (!provider.definition.testConnection) {
      return true;
    }
    try {
      return await provider.definition.testConnection(pluginCfg.pluginConfig, http);
    } catch (e) {
      console.error(
        `[PluginIssueAdapter] testConnection failed for ${pluginCfg.issueProviderKey}:`,
        e,
      );
      return false;
    }
  }

  async issueLink(issueId: string | number, issueProviderId: string): Promise<string> {
    const cfg = await this._getCfg(issueProviderId);
    if (!cfg) {
      return '';
    }
    const provider = this._registry.getProvider(cfg.issueProviderKey);
    if (!provider) {
      return '';
    }
    try {
      return await provider.definition.getIssueLink(String(issueId), cfg.pluginConfig);
    } catch (e) {
      console.error(
        `[PluginIssueAdapter] getIssueLink failed for ${cfg.issueProviderKey}:`,
        e,
      );
      return '';
    }
  }

  async getById(id: string | number, issueProviderId: string): Promise<IssueData | null> {
    const cfg = await this._getCfg(issueProviderId);
    if (!cfg) {
      return null;
    }
    const resolved = this._resolve(cfg);
    if (!resolved) {
      return null;
    }
    try {
      return await resolved.provider.definition.getById(
        String(id),
        cfg.pluginConfig,
        resolved.http,
      );
    } catch (e) {
      console.error(
        `[PluginIssueAdapter] getById failed for ${cfg.issueProviderKey}:`,
        e,
      );
      return null;
    }
  }

  getAddTaskData(issueData: IssueDataReduced): IssueTask {
    const data = issueData as PluginIssue;
    const isDone = this._computeIsDone(data);

    return {
      title: ((data as Record<string, unknown>)['summary'] as string) || data.title,
      issueId: data.id,
      issueWasUpdated: false,
      issueLastUpdated: data.lastUpdated ?? Date.now(),
      issueAttachmentNr: 0,
      issuePoints: undefined,
      issueTimeTracked: undefined,
      isDone,
    };
  }

  async searchIssues(
    searchTerm: string,
    issueProviderId: string,
  ): Promise<SearchResultItem[]> {
    const cfg = await this._getCfg(issueProviderId);
    if (!cfg) {
      return [];
    }
    const resolved = this._resolve(cfg);
    if (!resolved) {
      return [];
    }
    try {
      const results = await resolved.provider.definition.searchIssues(
        searchTerm,
        cfg.pluginConfig,
        resolved.http,
      );
      return results.map((r) => ({
        title: r.title,
        issueType: cfg.issueProviderKey,
        issueData: r,
      })) as SearchResultItem[];
    } catch (e) {
      console.error(
        `[PluginIssueAdapter] searchIssues failed for ${cfg.issueProviderKey}:`,
        e,
      );
      this._snackService.open({
        type: 'ERROR',
        msg: `Search failed for ${resolved.provider.name}`,
      });
      return [];
    }
  }

  async getFreshDataForIssueTask(task: Task): Promise<{
    taskChanges: Partial<Task>;
    issue: IssueData;
    issueTitle: string;
  } | null> {
    if (!task.issueProviderId || !task.issueId) {
      return null;
    }
    const cfg = await this._getCfg(task.issueProviderId);
    if (!cfg) {
      return null;
    }
    const resolved = this._resolve(cfg);
    if (!resolved) {
      return null;
    }
    try {
      const issue = await resolved.provider.definition.getById(
        task.issueId,
        cfg.pluginConfig,
        resolved.http,
      );
      if (!issue) {
        return null;
      }
      const isUpdated =
        issue.lastUpdated != null && issue.lastUpdated > (task.issueLastUpdated || 0);
      if (isUpdated) {
        const addTaskData = this.getAddTaskData(issue);
        const issueLastSyncedValues =
          resolved.provider.definition.extractSyncValues?.(issue);
        return {
          taskChanges: {
            ...addTaskData,
            issueWasUpdated: true,
            ...(issueLastSyncedValues ? { issueLastSyncedValues } : {}),
          },
          issue,
          issueTitle: issue.title,
        };
      }
      return null;
    } catch (e) {
      console.error(
        `[PluginIssueAdapter] getFreshDataForIssueTask failed for ${cfg.issueProviderKey}:`,
        e,
      );
      return null;
    }
  }

  async getFreshDataForIssueTasks(
    tasks: Task[],
  ): Promise<{ task: Task; taskChanges: Partial<Task>; issue: IssueData }[]> {
    const results: { task: Task; taskChanges: Partial<Task>; issue: IssueData }[] = [];
    for (const task of tasks) {
      const result = await this.getFreshDataForIssueTask(task);
      if (result) {
        results.push({ task, taskChanges: result.taskChanges, issue: result.issue });
      }
    }
    return results;
  }

  async getNewIssuesToAddToBacklog(
    issueProviderId: string,
    allExistingIssueIds: string[] | number[],
  ): Promise<IssueDataReduced[]> {
    const cfg = await this._getCfg(issueProviderId);
    if (!cfg) {
      return [];
    }
    const resolved = this._resolve(cfg);
    if (!resolved || !resolved.provider.definition.getNewIssuesForBacklog) {
      return [];
    }
    try {
      const results = await resolved.provider.definition.getNewIssuesForBacklog(
        cfg.pluginConfig,
        resolved.http,
      );
      const existingIds = new Set(allExistingIssueIds.map(String));
      return results.filter((r) => !existingIds.has(r.id));
    } catch (e) {
      console.error(
        `[PluginIssueAdapter] getNewIssuesToAddToBacklog failed for ${cfg.issueProviderKey}:`,
        e,
      );
      this._snackService.open({
        type: 'ERROR',
        msg: `Backlog import failed for ${resolved.provider.name}`,
      });
      return [];
    }
  }

  // --- Private helpers ---

  private _asPluginCfg(cfg: IssueIntegrationCfg): IssueProviderPluginType | undefined {
    const candidate = cfg as unknown as Record<string, unknown>;
    if (
      typeof candidate['pluginId'] !== 'string' ||
      typeof candidate['issueProviderKey'] !== 'string' ||
      typeof candidate['pluginConfig'] !== 'object' ||
      candidate['pluginConfig'] === null
    ) {
      return undefined;
    }
    return cfg as unknown as IssueProviderPluginType;
  }

  private _resolve(cfg: IssueProviderPluginType):
    | {
        provider: RegisteredPluginIssueProvider;
        http: PluginHttp;
      }
    | undefined {
    const provider = this._registry.getProvider(cfg.issueProviderKey);
    if (!provider) {
      return undefined;
    }
    const http = this._pluginHttp.createHttpHelper(() =>
      provider.definition.getHeaders(cfg.pluginConfig),
    );
    return { provider, http };
  }

  private async _getCfg(
    issueProviderId: string,
  ): Promise<IssueProviderPluginType | undefined> {
    try {
      const provider = await firstValueFrom(
        this._store.select(selectIssueProviderById(issueProviderId, null)),
      );
      if (!provider || !this._registry.hasProvider(provider.issueProviderKey)) {
        return undefined;
      }
      return provider as IssueProviderPluginType | undefined;
    } catch {
      return undefined;
    }
  }

  private _computeIsDone(issue: PluginIssue): boolean {
    const state = issue.state?.toLowerCase();
    if (!state) {
      return false;
    }
    return ['closed', 'done', 'completed', 'resolved'].includes(state);
  }
}
