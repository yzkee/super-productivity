/* eslint-disable @typescript-eslint/naming-convention */
import { T } from '../../../t.const';
import { ConfigFormSection, SyncConfig } from '../global-config.model';
import { LegacySyncProvider } from '../../../imex/sync/legacy-sync-provider.model';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { IS_ELECTRON } from '../../../app.constants';
import { fileSyncDroid, fileSyncElectron } from '../../../op-log/model/model-config';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { IS_NATIVE_PLATFORM } from '../../../util/is-native-platform';
import {
  openDisableEncryptionDialog,
  openDisableEncryptionDialogForFileBased,
  openEnableEncryptionDialog,
  openEnableEncryptionDialogForFileBased,
  openEncryptionPasswordChangeDialog,
  openEncryptionPasswordChangeDialogForFileBased,
} from '../../../imex/sync/encryption-password-dialog-opener.service';

/**
 * Creates form fields for WebDAV-based sync providers.
 * Reusable for both standard WebDAV and SuperSync.
 *
 * @param options - Configuration options for the form fields
 * @returns Array of Formly field configurations
 */
const createWebdavFormFields = (options: {
  corsInfoText: string;
  baseUrlDescription: string;
}): FormlyFieldConfig[] => {
  return [
    // Hide CORS info for Electron and native mobile apps (iOS/Android) since they handle CORS natively
    ...(!IS_ELECTRON && !IS_NATIVE_PLATFORM
      ? [
          {
            type: 'tpl',
            templateOptions: {
              tag: 'p',
              text: options.corsInfoText,
            },
          },
        ]
      : []),
    {
      key: 'baseUrl',
      type: 'input',
      className: 'e2e-baseUrl',
      templateOptions: {
        label: T.F.SYNC.FORM.WEB_DAV.L_BASE_URL,
        description: options.baseUrlDescription,
      },
      expressions: {
        'props.required': (field: FormlyFieldConfig) =>
          field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.WebDAV,
      },
    },
    {
      key: 'userName',
      type: 'input',
      className: 'e2e-userName',
      templateOptions: {
        label: T.F.SYNC.FORM.WEB_DAV.L_USER_NAME,
      },
      expressions: {
        'props.required': (field: FormlyFieldConfig) =>
          field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.WebDAV,
      },
    },
    {
      key: 'password',
      type: 'input',
      className: 'e2e-password',
      templateOptions: {
        type: 'password',
        label: T.F.SYNC.FORM.WEB_DAV.L_PASSWORD,
      },
      expressions: {
        'props.required': (field: FormlyFieldConfig) =>
          field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.WebDAV,
      },
    },
    {
      key: 'syncFolderPath',
      type: 'input',
      className: 'e2e-syncFolderPath',
      templateOptions: {
        label: T.F.SYNC.FORM.WEB_DAV.L_SYNC_FOLDER_PATH,
      },
      expressions: {
        'props.required': (field: FormlyFieldConfig) =>
          field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.WebDAV,
      },
    },
  ];
};

export const SYNC_FORM: ConfigFormSection<SyncConfig> = {
  title: T.F.SYNC.FORM.TITLE,
  key: 'sync',
  items: [
    {
      key: 'isEnabled',
      className: 'tour-isSyncEnabledToggle',
      type: 'checkbox',
      templateOptions: {
        label: T.F.SYNC.FORM.L_ENABLE_SYNCING,
      },
    },

    {
      key: 'syncProvider',
      type: 'select',
      templateOptions: {
        label: T.F.SYNC.FORM.L_SYNC_PROVIDER,
        required: true,
        options: [
          { label: 'SuperSync (Beta)', value: LegacySyncProvider.SuperSync },
          { label: LegacySyncProvider.Dropbox, value: LegacySyncProvider.Dropbox },
          { label: LegacySyncProvider.WebDAV, value: LegacySyncProvider.WebDAV },
          ...(IS_ELECTRON || IS_ANDROID_WEB_VIEW
            ? [
                {
                  label: LegacySyncProvider.LocalFile,
                  value: LegacySyncProvider.LocalFile,
                },
              ]
            : []),
        ],
      },
    },
    {
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider !== LegacySyncProvider.LocalFile ||
        IS_ANDROID_WEB_VIEW,
      resetOnHide: true,
      key: 'localFileSync',
      fieldGroup: [
        {
          type: 'btn',
          key: 'syncFolderPath',
          templateOptions: {
            text: T.F.SYNC.FORM.LOCAL_FILE.L_SYNC_FOLDER_PATH,
            onClick: () => {
              return fileSyncElectron.pickDirectory();
            },
          },
          expressions: {
            'props.required': (field: FormlyFieldConfig) =>
              field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.LocalFile,
          },
        },
      ],
    },
    {
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider !== LegacySyncProvider.LocalFile ||
        !IS_ANDROID_WEB_VIEW,
      resetOnHide: true,
      key: 'localFileSync',
      fieldGroup: [
        {
          type: 'btn',
          key: 'safFolderUri',
          templateOptions: {
            text: T.F.SYNC.FORM.LOCAL_FILE.L_SYNC_FOLDER_PATH,
            onClick: () => {
              // NOTE: this actually sets the value in the model
              return fileSyncDroid.setupSaf();
            },
          },
          expressions: {
            'props.required': (field: FormlyFieldConfig) =>
              field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.LocalFile,
          },
        },
      ],
    },

    // WebDAV provider form fields
    {
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider !== LegacySyncProvider.WebDAV,
      resetOnHide: true,
      key: 'webDav',
      fieldGroup: createWebdavFormFields({
        corsInfoText: T.F.SYNC.FORM.WEB_DAV.CORS_INFO,
        baseUrlDescription:
          '* https://your-next-cloud/nextcloud/remote.php/dav/files/yourUserName/',
      }),
    },

    // SuperSync provider form fields
    // NOTE: We use hideExpression on individual fields instead of the fieldGroup
    // because Formly doesn't include values from hidden fieldGroups in the model output
    {
      key: 'superSync',
      fieldGroup: [
        {
          hideExpression: (m, v, field) =>
            field?.parent?.parent?.model.syncProvider !== LegacySyncProvider.SuperSync,
          type: 'btn',
          templateOptions: {
            text: T.F.SYNC.FORM.SUPER_SYNC.BTN_GET_TOKEN,
            tooltip: T.F.SYNC.FORM.SUPER_SYNC.LOGIN_INSTRUCTIONS,
            btnType: 'primary',
            centerBtn: true,
            onClick: (field: any) => {
              const baseUrl = field.model.baseUrl;
              if (baseUrl) {
                window.open(baseUrl, '_blank');
              } else {
                alert('Please enter a Server URL first');
              }
            },
          },
        },
        {
          hideExpression: (m, v, field) =>
            field?.parent?.parent?.model.syncProvider !== LegacySyncProvider.SuperSync,
          key: 'accessToken',
          type: 'textarea',
          className: 'e2e-accessToken',
          templateOptions: {
            label: T.F.SYNC.FORM.SUPER_SYNC.L_ACCESS_TOKEN,
            description: T.F.SYNC.FORM.SUPER_SYNC.ACCESS_TOKEN_DESCRIPTION,
            rows: 3,
          },
          expressions: {
            'props.required': (field: FormlyFieldConfig) =>
              field?.parent?.parent?.model?.syncProvider === LegacySyncProvider.SuperSync,
          },
        },
        // Advanced settings for SuperSync
        {
          type: 'collapsible',
          hideExpression: (m, v, field) =>
            field?.parent?.parent?.model.syncProvider !== LegacySyncProvider.SuperSync,
          props: { label: T.G.ADVANCED_CFG },
          fieldGroup: [
            // Encryption password field for SuperSync (shown when encryption is disabled)
            {
              hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
                field?.model?.isEncryptionEnabled ?? false,
              key: 'encryptKey',
              type: 'input',
              className: 'e2e-encryptKey',
              templateOptions: {
                type: 'password',
                label: T.F.SYNC.FORM.L_ENCRYPTION_PASSWORD,
              },
            },
            {
              hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
                field?.model?.isEncryptionEnabled ?? false,
              type: 'tpl',
              className: 'tpl warn-text',
              templateOptions: {
                tag: 'div',
                text: T.F.SYNC.FORM.SUPER_SYNC.ENCRYPTION_WARNING,
              },
            },
            {
              // Note: Using (m, v, field) signature for btn type fields to ensure
              // hideExpression works correctly with the btn component.
              // Using ?? false to ensure button stays hidden if field is undefined.
              hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
                field?.model?.isEncryptionEnabled ?? false,
              type: 'btn',
              className: 'e2e-enable-encryption-btn',
              templateOptions: {
                text: T.F.SYNC.FORM.SUPER_SYNC.BTN_ENABLE_ENCRYPTION,
                btnType: 'primary',
                onClick: async (field: FormlyFieldConfig) => {
                  const encryptKey = field?.model?.encryptKey || '';
                  const result = await openEnableEncryptionDialog(encryptKey);
                  if (result?.success && field?.model) {
                    field.model.isEncryptionEnabled = true;
                  }
                  return result?.success ? true : false;
                },
              },
            },
            {
              // Note: Using (m, v, field) signature for btn type fields to ensure
              // hideExpression works correctly with the btn component.
              // Using ?? false to ensure button stays hidden if field is undefined.
              hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
                !(field?.model?.isEncryptionEnabled ?? false),
              type: 'btn',
              templateOptions: {
                text: T.F.SYNC.FORM.SUPER_SYNC.BTN_CHANGE_PASSWORD,
                btnType: 'default',
                onClick: async () => {
                  const result = await openEncryptionPasswordChangeDialog();
                  // Password is updated through the service, no need to update form
                  return result?.success ? true : false;
                },
              },
            },
            {
              // Note: Using (m, v, field) signature for btn type fields to ensure
              // hideExpression works correctly with the btn component.
              // Using ?? false to ensure button stays hidden if field is undefined.
              hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
                !(field?.model?.isEncryptionEnabled ?? false),
              type: 'btn',
              className: 'e2e-disable-encryption-btn',
              templateOptions: {
                text: T.F.SYNC.FORM.SUPER_SYNC.BTN_DISABLE_ENCRYPTION,
                btnType: 'default',
                onClick: async (field: FormlyFieldConfig) => {
                  const result = await openDisableEncryptionDialog();
                  if (result?.success && result?.encryptionRemoved && field?.model) {
                    field.model.isEncryptionEnabled = false;
                    field.model.encryptKey = '';
                  }
                  return result?.success ? true : false;
                },
              },
            },
            {
              // Using ?? false to ensure message stays hidden if field is undefined
              hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
                !(field?.model?.isEncryptionEnabled ?? false) ||
                !(field?.model?.encryptKey ?? false),
              type: 'tpl',
              className: 'tpl',
              templateOptions: {
                tag: 'div',
                text: T.F.SYNC.FORM.SUPER_SYNC.PASSWORD_SET_INFO,
              },
            },
            // Server URL
            {
              key: 'baseUrl',
              type: 'input',
              className: 'e2e-baseUrl',
              templateOptions: {
                label: T.F.SYNC.FORM.SUPER_SYNC.L_SERVER_URL,
                description: T.F.SYNC.FORM.SUPER_SYNC.SERVER_URL_DESCRIPTION,
              },
              expressions: {
                'props.required': (field: FormlyFieldConfig) =>
                  field?.parent?.parent?.parent?.model?.syncProvider ===
                  LegacySyncProvider.SuperSync,
              },
            },
          ],
        },
      ],
    },

    {
      key: 'syncInterval',
      type: 'duration',
      // NOTE: we don't hide because model updates don't seem to work properly for this
      // hideExpression: ((model: DropboxSyncConfig) => !model.accessToken),
      // Hide for SuperSync (uses fixed interval) and when manual sync only is enabled
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider === LegacySyncProvider.SuperSync ||
        field?.parent?.model.isManualSyncOnly === true,
      resetOnHide: true,
      templateOptions: {
        required: true,
        isAllowSeconds: true,
        label: T.F.SYNC.FORM.L_SYNC_INTERVAL,
        description: T.G.DURATION_DESCRIPTION,
      },
    },
    {
      key: 'isManualSyncOnly',
      type: 'checkbox',
      // Only show for file-based providers (Dropbox, WebDAV, LocalFile)
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider === LegacySyncProvider.SuperSync ||
        field?.parent?.model.syncProvider === null,
      templateOptions: {
        label: T.F.SYNC.FORM.L_MANUAL_SYNC_ONLY,
      },
    },

    // COMMON SETTINGS
    // Hide for SuperSync - uses fixed settings (no compression config, encryption handled separately)
    {
      type: 'collapsible',
      hideExpression: (m, v, field) =>
        field?.parent?.model.syncProvider === LegacySyncProvider.SuperSync,
      props: { label: T.G.ADVANCED_CFG },
      fieldGroup: [
        {
          key: 'isCompressionEnabled',
          type: 'checkbox',
          templateOptions: {
            label: T.F.SYNC.FORM.L_ENABLE_COMPRESSION,
          },
        },
        // Encryption notes - show before enabling encryption
        {
          hideExpression: (m: any, v: any, field: any) =>
            field?.parent?.parent?.model.syncProvider === LegacySyncProvider.SuperSync ||
            m.isEncryptionEnabled,
          type: 'tpl',
          className: 'tpl',
          templateOptions: {
            tag: 'div',
            text: T.F.SYNC.FORM.L_ENCRYPTION_NOTES,
          },
        },
        // Password input - shown when encryption is disabled
        {
          hideExpression: (m: any, v: any, field: any) =>
            field?.parent?.parent?.model.syncProvider === LegacySyncProvider.SuperSync ||
            m.isEncryptionEnabled,
          resetOnHide: false,
          key: 'encryptKey',
          type: 'input',
          className: 'e2e-file-based-encrypt-key',
          templateOptions: {
            type: 'password',
            label: T.F.SYNC.FORM.L_ENCRYPTION_PASSWORD,
          },
        },
        {
          hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
            field?.parent?.parent?.model.syncProvider === LegacySyncProvider.SuperSync ||
            m.isEncryptionEnabled,
          type: 'btn',
          className: 'e2e-file-based-enable-encryption-btn',
          templateOptions: {
            text: T.F.SYNC.FORM.FILE_BASED.BTN_ENABLE_ENCRYPTION,
            btnType: 'primary',
            onClick: async (field: FormlyFieldConfig) => {
              const encryptKey = field?.model?.encryptKey || '';
              const result = await openEnableEncryptionDialogForFileBased(encryptKey);
              if (result?.success && field?.model) {
                field.model.isEncryptionEnabled = true;
              }
              return result?.success ? true : false;
            },
          },
          expressions: {
            'props.disabled': (field: FormlyFieldConfig) => !field?.model?.encryptKey,
          },
        },
        {
          hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
            field?.parent?.parent?.model.syncProvider === LegacySyncProvider.SuperSync ||
            !m.isEncryptionEnabled,
          type: 'btn',
          className: 'e2e-file-based-change-password-btn',
          templateOptions: {
            text: T.F.SYNC.FORM.FILE_BASED.BTN_CHANGE_PASSWORD,
            btnType: 'default',
            onClick: async () => {
              const result = await openEncryptionPasswordChangeDialogForFileBased();
              return result?.success ? true : false;
            },
          },
        },
        {
          hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
            field?.parent?.parent?.model.syncProvider === LegacySyncProvider.SuperSync ||
            !m.isEncryptionEnabled,
          type: 'btn',
          className: 'e2e-file-based-disable-encryption-btn',
          templateOptions: {
            text: T.F.SYNC.FORM.FILE_BASED.BTN_DISABLE_ENCRYPTION,
            btnType: 'default',
            onClick: async (field: FormlyFieldConfig) => {
              const result = await openDisableEncryptionDialogForFileBased();
              if (result?.success && result?.encryptionRemoved && field?.model) {
                field.model.isEncryptionEnabled = false;
                field.model.encryptKey = '';
              }
              return result?.success ? true : false;
            },
          },
        },
        {
          hideExpression: (m: any, v: any, field?: FormlyFieldConfig) =>
            field?.parent?.parent?.model.syncProvider === LegacySyncProvider.SuperSync ||
            !m.isEncryptionEnabled ||
            !m?.encryptKey,
          type: 'tpl',
          className: 'tpl',
          templateOptions: {
            tag: 'div',
            text: T.F.SYNC.FORM.FILE_BASED.PASSWORD_SET_INFO,
          },
        },
      ],
    },
  ],
};
