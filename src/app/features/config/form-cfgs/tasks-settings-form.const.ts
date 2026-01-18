import { ConfigFormSection, TasksConfig } from '../global-config.model';
import { T } from '../../../t.const';

export const TASKS_SETTINGS_FORM_CFG: ConfigFormSection<TasksConfig> = {
  title: T.GCF.TASKS.TITLE,
  key: 'tasks',
  items: [
    {
      key: 'isConfirmBeforeTaskDelete',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASKS.IS_CONFIRM_BEFORE_TASK_DELETE,
      },
    },
    {
      key: 'isAutoMarkParentAsDone',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASKS.IS_AUTO_MARK_PARENT_AS_DONE,
      },
    },
    {
      key: 'isAutoAddWorkedOnToToday',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASKS.IS_AUTO_ADD_WORKED_ON_TO_TODAY,
      },
    },
    {
      key: 'isTrayShowCurrentTask',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASKS.IS_TRAY_SHOW_CURRENT_TASK,
      },
    },
    {
      key: 'defaultProjectId',
      type: 'project-select',
      templateOptions: {
        label: T.GCF.TASKS.DEFAULT_PROJECT,
      },
    },
    {
      key: 'isMarkdownNotesEnabled',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.TASKS.IS_MARKDOWN_NOTES_ENABLED,
      },
    },
    {
      key: 'notesTemplate',
      type: 'textarea',
      templateOptions: {
        rows: 5,
        label: T.GCF.TASKS.NOTES_TEMPLATE,
      },
    },
  ],
};
