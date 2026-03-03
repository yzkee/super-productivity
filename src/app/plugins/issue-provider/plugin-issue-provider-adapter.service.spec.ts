import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';
import { PluginIssueProviderAdapterService } from './plugin-issue-provider-adapter.service';
import { PluginIssueProviderRegistryService } from './plugin-issue-provider-registry.service';
import { PluginHttpService } from './plugin-http.service';
import {
  IssueProviderPluginDefinition,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
  RegisteredPluginIssueProvider,
} from './plugin-issue-provider.model';
import { IssueProviderPluginType } from '../../features/issue/issue.model';
import { Task } from '../../features/tasks/task.model';
import { SnackService } from '../../core/snack/snack.service';

describe('PluginIssueProviderAdapterService', () => {
  let service: PluginIssueProviderAdapterService;
  let registrySpy: jasmine.SpyObj<PluginIssueProviderRegistryService>;
  let pluginHttpSpy: jasmine.SpyObj<PluginHttpService>;
  let storeSpy: jasmine.SpyObj<Store>;
  let snackSpy: jasmine.SpyObj<SnackService>;

  const PLUGIN_KEY = 'plugin:test-plugin';
  const PROVIDER_ID = 'provider-123';

  const mockPluginConfig: Record<string, unknown> = { apiUrl: 'https://example.com' };

  const mockPluginCfg: IssueProviderPluginType = {
    id: PROVIDER_ID,
    isEnabled: true,
    issueProviderKey: PLUGIN_KEY,
    pluginId: 'test-plugin',
    pluginConfig: mockPluginConfig,
  } as IssueProviderPluginType;

  const mockHttpHelper: PluginHttp = {
    get: jasmine.createSpy('get'),
    post: jasmine.createSpy('post'),
    put: jasmine.createSpy('put'),
    patch: jasmine.createSpy('patch'),
    delete: jasmine.createSpy('delete'),
  };

  const createMockDefinition = (
    overrides: Partial<IssueProviderPluginDefinition> = {},
  ): IssueProviderPluginDefinition => ({
    configFields: [],
    getHeaders: jasmine.createSpy('getHeaders').and.returnValue({}),
    searchIssues: jasmine
      .createSpy('searchIssues')
      .and.resolveTo([] as PluginSearchResult[]),
    getById: jasmine.createSpy('getById').and.resolveTo({
      id: '1',
      title: 'Test Issue',
    } as PluginIssue),
    getIssueLink: jasmine.createSpy('getIssueLink').and.returnValue('https://link'),
    issueDisplay: [],
    ...overrides,
  });

  const createMockProvider = (
    defOverrides: Partial<IssueProviderPluginDefinition> = {},
  ): RegisteredPluginIssueProvider => ({
    pluginId: 'test-plugin',
    registeredKey: PLUGIN_KEY,
    definition: createMockDefinition(defOverrides),
    name: 'Test Plugin',
    icon: 'bug_report',
    pollIntervalMs: 5000,
    issueStrings: { singular: 'Issue', plural: 'Issues' },
  });

  beforeEach(() => {
    registrySpy = jasmine.createSpyObj('PluginIssueProviderRegistryService', [
      'getProvider',
      'hasProvider',
    ]);
    pluginHttpSpy = jasmine.createSpyObj('PluginHttpService', ['createHttpHelper']);
    storeSpy = jasmine.createSpyObj('Store', ['select']);

    snackSpy = jasmine.createSpyObj('SnackService', ['open']);
    pluginHttpSpy.createHttpHelper.and.returnValue(mockHttpHelper);
    storeSpy.select.and.returnValue(of(mockPluginCfg));
    registrySpy.hasProvider.and.returnValue(true);

    TestBed.configureTestingModule({
      providers: [
        PluginIssueProviderAdapterService,
        { provide: PluginIssueProviderRegistryService, useValue: registrySpy },
        { provide: PluginHttpService, useValue: pluginHttpSpy },
        { provide: Store, useValue: storeSpy },
        { provide: SnackService, useValue: snackSpy },
      ],
    });

    service = TestBed.inject(PluginIssueProviderAdapterService);
  });

  describe('isEnabled', () => {
    it('should always return true', () => {
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('pollInterval', () => {
    it('should be 0', () => {
      expect(service.pollInterval).toBe(0);
    });
  });

  describe('testConnection', () => {
    it('should delegate to plugin definition testConnection', async () => {
      const testConnectionSpy = jasmine.createSpy('testConnection').and.resolveTo(true);
      const provider = createMockProvider({ testConnection: testConnectionSpy });
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.testConnection(
        mockPluginCfg as unknown as Parameters<typeof service.testConnection>[0],
      );

      expect(result).toBe(true);
      expect(testConnectionSpy).toHaveBeenCalledWith(mockPluginConfig, mockHttpHelper);
    });

    it('should return true when plugin definition has no testConnection', async () => {
      const provider = createMockProvider();
      delete (provider.definition as Partial<IssueProviderPluginDefinition>)
        .testConnection;
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.testConnection(
        mockPluginCfg as unknown as Parameters<typeof service.testConnection>[0],
      );

      expect(result).toBe(true);
    });

    it('should return false when plugin is not registered', async () => {
      registrySpy.getProvider.and.returnValue(undefined);

      const result = await service.testConnection(
        mockPluginCfg as unknown as Parameters<typeof service.testConnection>[0],
      );

      expect(result).toBe(false);
    });

    it('should return false when testConnection rejects', async () => {
      const testConnectionSpy = jasmine
        .createSpy('testConnection')
        .and.rejectWith(new Error('Connection failed'));
      const provider = createMockProvider({ testConnection: testConnectionSpy });
      registrySpy.getProvider.and.returnValue(provider);
      spyOn(console, 'error');

      const result = await service.testConnection(
        mockPluginCfg as unknown as Parameters<typeof service.testConnection>[0],
      );

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('searchIssues', () => {
    it('should delegate to plugin definition and map results to SearchResultItem[]', async () => {
      const searchResults: PluginSearchResult[] = [
        { id: 'ISS-1', title: 'First Issue' },
        { id: 'ISS-2', title: 'Second Issue', status: 'open' },
      ];
      const provider = createMockProvider({
        searchIssues: jasmine.createSpy('searchIssues').and.resolveTo(searchResults),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.searchIssues('test query', PROVIDER_ID);

      expect(result.length).toBe(2);
      expect(result[0]).toEqual({
        title: 'First Issue',
        issueType: PLUGIN_KEY,
        issueData: searchResults[0],
      });
      expect(result[1]).toEqual({
        title: 'Second Issue',
        issueType: PLUGIN_KEY,
        issueData: searchResults[1],
      });
      expect(provider.definition.searchIssues).toHaveBeenCalledWith(
        'test query',
        mockPluginConfig,
        mockHttpHelper,
      );
    });

    it('should return empty array when provider is not registered', async () => {
      registrySpy.getProvider.and.returnValue(undefined);

      const result = await service.searchIssues('test query', PROVIDER_ID);

      expect(result).toEqual([]);
    });

    it('should return empty array when cfg is not found in store', async () => {
      storeSpy.select.and.returnValue(throwError(() => new Error('Not found')));

      const result = await service.searchIssues('test query', PROVIDER_ID);

      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('should delegate to plugin definition getById', async () => {
      const issue: PluginIssue = {
        id: 'ISS-42',
        title: 'Found Issue',
        lastUpdated: 1000,
      };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(issue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.getById('ISS-42', PROVIDER_ID);

      expect(result).toEqual(issue);
      expect(provider.definition.getById).toHaveBeenCalledWith(
        'ISS-42',
        mockPluginConfig,
        mockHttpHelper,
      );
    });

    it('should convert numeric id to string when calling getById', async () => {
      const issue: PluginIssue = { id: '123', title: 'Numeric Issue' };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(issue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      await service.getById(123, PROVIDER_ID);

      expect(provider.definition.getById).toHaveBeenCalledWith(
        '123',
        mockPluginConfig,
        mockHttpHelper,
      );
    });

    it('should return null when provider is not registered', async () => {
      registrySpy.getProvider.and.returnValue(undefined);

      const result = await service.getById('ISS-42', PROVIDER_ID);

      expect(result).toBeNull();
    });

    it('should return null when cfg is not found', async () => {
      storeSpy.select.and.returnValue(throwError(() => new Error('Not found')));

      const result = await service.getById('ISS-42', PROVIDER_ID);

      expect(result).toBeNull();
    });
  });

  describe('getAddTaskData', () => {
    it('should synthesize IssueTask from IssueDataReduced', () => {
      const issueData = { id: 'ISS-10', title: 'New Feature' } as PluginSearchResult;

      const result = service.getAddTaskData(issueData);

      expect(result.title).toBe('New Feature');
      expect(result.issueId).toBe('ISS-10');
      expect(result.issueWasUpdated).toBe(false);
      expect(result.issueAttachmentNr).toBe(0);
      expect(result.issuePoints).toBeUndefined();
      expect(result.issueTimeTracked).toBeUndefined();
    });

    it('should set issueLastUpdated to approximately now', () => {
      const before = Date.now();
      const result = service.getAddTaskData({
        id: 'X-1',
        title: 'Test',
      } as PluginSearchResult);
      const after = Date.now();

      expect(result.issueLastUpdated).toBeGreaterThanOrEqual(before);
      expect(result.issueLastUpdated).toBeLessThanOrEqual(after);
    });
  });

  describe('getFreshDataForIssueTask', () => {
    it('should return null when task has no issueProviderId', async () => {
      const task = { id: 'task-1', issueId: 'ISS-1' } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return null when task has no issueId', async () => {
      const task = { id: 'task-1', issueProviderId: PROVIDER_ID } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return fresh data with taskChanges when issue is updated', async () => {
      const freshIssue: PluginIssue = {
        id: 'ISS-5',
        title: 'Updated Issue',
        lastUpdated: 2000,
      };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const task = {
        id: 'task-1',
        issueId: 'ISS-5',
        issueProviderId: PROVIDER_ID,
        issueLastUpdated: 1000,
      } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).not.toBeNull();
      expect(result!.issue).toEqual(freshIssue);
      expect(result!.issueTitle).toBe('Updated Issue');
      expect(result!.taskChanges.issueWasUpdated).toBe(true);
      expect(result!.taskChanges.issueLastUpdated).toBe(2000);
      expect(result!.taskChanges.title).toBe('Updated Issue');
    });

    it('should return null when issue is not updated', async () => {
      const freshIssue: PluginIssue = {
        id: 'ISS-5',
        title: 'Same Issue',
        lastUpdated: 1000,
      };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const task = {
        id: 'task-1',
        issueId: 'ISS-5',
        issueProviderId: PROVIDER_ID,
        issueLastUpdated: 1000,
      } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return null when issue has no lastUpdated', async () => {
      const freshIssue: PluginIssue = {
        id: 'ISS-5',
        title: 'No Update Time',
      };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const task = {
        id: 'task-1',
        issueId: 'ISS-5',
        issueProviderId: PROVIDER_ID,
        issueLastUpdated: 1000,
      } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return null when getById returns null', async () => {
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(null),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const task = {
        id: 'task-1',
        issueId: 'ISS-5',
        issueProviderId: PROVIDER_ID,
      } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });

    it('should return null when provider is not registered', async () => {
      registrySpy.getProvider.and.returnValue(undefined);

      const task = {
        id: 'task-1',
        issueId: 'ISS-5',
        issueProviderId: PROVIDER_ID,
      } as Task;

      const result = await service.getFreshDataForIssueTask(task);

      expect(result).toBeNull();
    });
  });

  describe('getFreshDataForIssueTasks', () => {
    it('should aggregate results for multiple tasks', async () => {
      const freshIssue: PluginIssue = {
        id: 'ISS-1',
        title: 'Issue One',
        lastUpdated: 5000,
      };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const tasks = [
        { id: 'task-1', issueId: 'ISS-1', issueProviderId: PROVIDER_ID } as Task,
        { id: 'task-2', issueId: 'ISS-1', issueProviderId: PROVIDER_ID } as Task,
      ];

      const result = await service.getFreshDataForIssueTasks(tasks);

      expect(result.length).toBe(2);
      expect(result[0].task.id).toBe('task-1');
      expect(result[1].task.id).toBe('task-2');
    });

    it('should skip tasks that return null from getFreshDataForIssueTask', async () => {
      const freshIssue: PluginIssue = {
        id: 'ISS-1',
        title: 'Issue One',
        lastUpdated: 5000,
      };
      const provider = createMockProvider({
        getById: jasmine.createSpy('getById').and.resolveTo(freshIssue),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const tasks = [
        { id: 'task-1', issueId: 'ISS-1', issueProviderId: PROVIDER_ID } as Task,
        { id: 'task-2' } as Task, // no issueProviderId - will return null
      ];

      const result = await service.getFreshDataForIssueTasks(tasks);

      expect(result.length).toBe(1);
      expect(result[0].task.id).toBe('task-1');
    });
  });

  describe('issueLink', () => {
    it('should delegate to getIssueLink on the definition', async () => {
      const provider = createMockProvider({
        getIssueLink: jasmine
          .createSpy('getIssueLink')
          .and.returnValue('https://tracker.example.com/ISS-7'),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.issueLink('ISS-7', PROVIDER_ID);

      expect(result).toBe('https://tracker.example.com/ISS-7');
      expect(provider.definition.getIssueLink).toHaveBeenCalledWith(
        'ISS-7',
        mockPluginConfig,
      );
    });

    it('should convert numeric issueId to string', async () => {
      const provider = createMockProvider({
        getIssueLink: jasmine
          .createSpy('getIssueLink')
          .and.returnValue('https://tracker.example.com/42'),
      });
      registrySpy.getProvider.and.returnValue(provider);

      await service.issueLink(42, PROVIDER_ID);

      expect(provider.definition.getIssueLink).toHaveBeenCalledWith(
        '42',
        mockPluginConfig,
      );
    });

    it('should return empty string when cfg is not found', async () => {
      storeSpy.select.and.returnValue(throwError(() => new Error('Not found')));

      const result = await service.issueLink('ISS-7', PROVIDER_ID);

      expect(result).toBe('');
    });

    it('should return empty string when provider is not registered', async () => {
      registrySpy.getProvider.and.returnValue(undefined);

      const result = await service.issueLink('ISS-7', PROVIDER_ID);

      expect(result).toBe('');
    });
  });

  describe('getNewIssuesToAddToBacklog', () => {
    it('should delegate to getNewIssuesForBacklog and filter existing ids', async () => {
      const backlogIssues: PluginSearchResult[] = [
        { id: 'ISS-1', title: 'New One' },
        { id: 'ISS-2', title: 'New Two' },
        { id: 'ISS-3', title: 'New Three' },
      ];
      const provider = createMockProvider({
        getNewIssuesForBacklog: jasmine
          .createSpy('getNewIssuesForBacklog')
          .and.resolveTo(backlogIssues),
      });
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.getNewIssuesToAddToBacklog!(PROVIDER_ID, ['ISS-2']);

      expect(result.length).toBe(2);
      expect(result.map((r) => (r as PluginSearchResult).id)).toEqual(['ISS-1', 'ISS-3']);
    });

    it('should return empty array when getNewIssuesForBacklog is not defined', async () => {
      const provider = createMockProvider();
      registrySpy.getProvider.and.returnValue(provider);

      const result = await service.getNewIssuesToAddToBacklog!(PROVIDER_ID, []);

      expect(result).toEqual([]);
    });

    it('should return empty array when provider is not registered', async () => {
      registrySpy.getProvider.and.returnValue(undefined);

      const result = await service.getNewIssuesToAddToBacklog!(PROVIDER_ID, []);

      expect(result).toEqual([]);
    });

    it('should return empty array when cfg is not found', async () => {
      storeSpy.select.and.returnValue(throwError(() => new Error('Not found')));

      const result = await service.getNewIssuesToAddToBacklog!(PROVIDER_ID, []);

      expect(result).toEqual([]);
    });
  });
});
