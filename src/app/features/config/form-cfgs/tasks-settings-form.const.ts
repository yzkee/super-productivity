import { ConfigFormSection, TasksConfig } from '../global-config.model';
import { T } from '../../../t.const';

export const TASKS_SETTINGS_FORM_CFG: ConfigFormSection<TasksConfig> = {
  title: T.PS.TABS.TASKS,
  key: 'tasks',
  items: [
    {
      key: 'isConfirmBeforeTaskDelete',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_CONFIRM_BEFORE_TASK_DELETE,
      },
    },
    {
      key: 'isAutMarkParentAsDone',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_AUTO_MARK_PARENT_AS_DONE,
      },
    },
    {
      key: 'isAutoAddWorkedOnToToday',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_AUTO_ADD_WORKED_ON_TO_TODAY,
      },
    },
    {
      key: 'isTrayShowCurrentTask',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_TRAY_SHOW_CURRENT_TASK,
      },
    },
    {
      key: 'defaultProjectId',
      type: 'project-select',
      templateOptions: {
        label: T.GCF.MISC.DEFAULT_PROJECT,
      },
    },
    {
      key: 'isTurnOffMarkdown',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.MISC.IS_TURN_OFF_MARKDOWN,
      },
    },
    {
      key: 'taskNotesTpl',
      type: 'textarea',
      templateOptions: {
        rows: 5,
        label: T.GCF.MISC.TASK_NOTES_TPL,
      },
    },
  ],
};
