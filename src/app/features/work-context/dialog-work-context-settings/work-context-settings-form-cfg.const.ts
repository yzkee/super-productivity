import { FormlyFieldConfig } from '@ngx-formly/core';
import { T } from '../../../t.const';
import { HUES } from '../work-context.const';

export const buildWorkContextSettingsFormCfg = (
  isProject: boolean,
): FormlyFieldConfig[] => {
  const basicFields: FormlyFieldConfig[] = [
    {
      key: 'title',
      type: 'input',
      templateOptions: {
        required: true,
        label: isProject ? T.F.PROJECT.FORM_BASIC.L_TITLE : T.F.TAG.FORM_BASIC.L_TITLE,
      },
    },
    {
      key: 'icon',
      type: 'icon',
      templateOptions: {
        label: T.F.TAG.FORM_BASIC.L_ICON,
        description: T.G.ICON_INP_DESCRIPTION,
      },
    },
  ];

  if (!isProject) {
    basicFields.push({
      key: 'color',
      type: 'color',
      templateOptions: {
        label: T.F.TAG.FORM_BASIC.L_COLOR,
      },
    });
  }

  if (isProject) {
    basicFields.push(
      {
        key: 'isEnableBacklog',
        type: 'checkbox',
        templateOptions: {
          label: T.F.PROJECT.FORM_BASIC.L_ENABLE_BACKLOG,
        },
      },
      {
        key: 'isHiddenFromMenu',
        type: 'checkbox',
        templateOptions: {
          label: T.F.PROJECT.FORM_BASIC.L_IS_HIDDEN_FROM_MENU,
        },
      },
    );
  }

  const themeFields: FormlyFieldConfig[] = [
    {
      fieldGroupClassName: 'formly-row',
      fieldGroup: [
        {
          key: 'primary',
          type: 'color',
          templateOptions: {
            label: T.F.PROJECT.FORM_THEME.L_COLOR_PRIMARY,
          },
        },
        {
          key: 'accent',
          type: 'color',
          templateOptions: {
            label: T.F.PROJECT.FORM_THEME.L_COLOR_ACCENT,
          },
        },
        {
          key: 'warn',
          type: 'color',
          templateOptions: {
            label: T.F.PROJECT.FORM_THEME.L_COLOR_WARN,
          },
        },
      ],
    },
    {
      key: 'isAutoContrast',
      type: 'checkbox',
      templateOptions: {
        label: T.F.PROJECT.FORM_THEME.L_IS_AUTO_CONTRAST,
      },
    },
    {
      key: 'huePrimary',
      type: 'select',
      hideExpression: 'model.isAutoContrast',
      templateOptions: {
        required: true,
        label: T.F.PROJECT.FORM_THEME.L_HUE_PRIMARY,
        options: HUES,
        valueProp: 'value',
        labelProp: 'label',
        placeholder: T.F.PROJECT.FORM_THEME.L_HUE_PRIMARY,
      },
    },
    {
      key: 'hueAccent',
      type: 'select',
      hideExpression: 'model.isAutoContrast',
      templateOptions: {
        required: true,
        label: T.F.PROJECT.FORM_THEME.L_HUE_ACCENT,
        options: HUES,
        valueProp: 'value',
        labelProp: 'label',
        placeholder: T.F.PROJECT.FORM_THEME.L_HUE_ACCENT,
      },
    },
    {
      key: 'hueWarn',
      type: 'select',
      hideExpression: 'model.isAutoContrast',
      templateOptions: {
        required: true,
        label: T.F.PROJECT.FORM_THEME.L_HUE_WARN,
        options: HUES,
        valueProp: 'value',
        labelProp: 'label',
        placeholder: T.F.PROJECT.FORM_THEME.L_HUE_WARN,
      },
    },
    {
      key: 'isDisableBackgroundTint',
      type: 'checkbox',
      expressions: {
        hide: (fCfg: FormlyFieldConfig) =>
          fCfg.model.backgroundImageDark || fCfg.model.backgroundImageLight,
      },
      templateOptions: {
        label: T.F.PROJECT.FORM_THEME.L_IS_DISABLE_BACKGROUND_TINT,
      },
    },
    {
      key: 'backgroundImageDark',
      type: 'image-input',
      templateOptions: {
        label: T.F.PROJECT.FORM_THEME.L_BACKGROUND_IMAGE_DARK,
        description: '* https://some/cool.jpg, file:///home/user/bg.png',
      },
    },
    {
      key: 'backgroundImageLight',
      type: 'image-input',
      templateOptions: {
        label: T.F.PROJECT.FORM_THEME.L_BACKGROUND_IMAGE_LIGHT,
        description: '* https://some/cool.jpg, file:///home/user/bg.png',
      },
    },
    {
      key: 'backgroundOverlayOpacity',
      type: 'slider',
      props: {
        label: T.F.PROJECT.FORM_THEME.L_BACKGROUND_OVERLAY_OPACITY,
        description: T.F.PROJECT.FORM_THEME.D_BACKGROUND_OVERLAY_OPACITY,
        type: 'number',
        min: 0,
        max: 99,
        required: false,
        displayWith: (value: number): string => `${value}%`,
      },
      expressions: {
        hide: (field: FormlyFieldConfig): boolean => {
          const isDarkTheme = document.body.classList.contains('isDarkTheme');
          return isDarkTheme
            ? !field.model.backgroundImageDark
            : !field.model.backgroundImageLight;
        },
      },
    },
  ];

  return [
    ...basicFields,
    {
      key: 'theme',
      fieldGroup: themeFields,
    },
  ];
};
