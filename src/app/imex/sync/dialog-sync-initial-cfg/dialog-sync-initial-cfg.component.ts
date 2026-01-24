import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { SYNC_FORM } from '../../../features/config/form-cfgs/sync-form.const';
import { FormGroup } from '@angular/forms';
import { FormlyConfigModule } from '../../../ui/formly-config.module';
import { FormlyModule } from '@ngx-formly/core';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { SyncConfig } from '../../../features/config/global-config.model';
import { LegacySyncProvider } from '../legacy-sync-provider.model';
import { SyncConfigService } from '../sync-config.service';
import { SyncWrapperService } from '../sync-wrapper.service';
import { EncryptionPasswordDialogOpenerService } from '../encryption-password-dialog-opener.service';
import { Subscription } from 'rxjs';
import { first, skip } from 'rxjs/operators';
import { toSyncProviderId } from '../../../op-log/sync-exports';
import { SyncLog } from '../../../core/log';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { GlobalConfigService } from '../../../features/config/global-config.service';

@Component({
  selector: 'dialog-sync-initial-cfg',
  templateUrl: './dialog-sync-initial-cfg.component.html',
  styleUrls: ['./dialog-sync-initial-cfg.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
    FormlyConfigModule,
    FormlyModule,
  ],
})
export class DialogSyncInitialCfgComponent implements AfterViewInit {
  syncConfigService = inject(SyncConfigService);
  syncWrapperService = inject(SyncWrapperService);
  private _encryptionPasswordDialogOpener = inject(EncryptionPasswordDialogOpenerService);
  private _providerManager = inject(SyncProviderManager);
  private _globalConfigService = inject(GlobalConfigService);

  T = T;
  isWasEnabled = signal(false);
  fields = signal(this._getFields(false));
  form = new FormGroup({});

  private _getFields(includeEnabledToggle: boolean): FormlyFieldConfig[] {
    const baseFields = SYNC_FORM.items!.filter(
      (f) => includeEnabledToggle || f.key !== 'isEnabled',
    );

    // Add the "Change Encryption Password" button
    const changePasswordBtn: FormlyFieldConfig = {
      hideExpression: (m: SyncConfig) =>
        m.syncProvider !== LegacySyncProvider.SuperSync ||
        !m.superSync?.isEncryptionEnabled,
      type: 'btn',
      className: 'mt2 block',
      props: {
        text: T.F.SYNC.FORM.SUPER_SYNC.L_CHANGE_ENCRYPTION_PASSWORD,
        btnType: 'stroked',
        required: false,
        onClick: () => {
          this._encryptionPasswordDialogOpener.openChangePasswordDialog();
        },
      },
    };

    return [...baseFields, changePasswordBtn];
  }
  _tmpUpdatedCfg: SyncConfig = {
    isEnabled: true,
    syncProvider: null,
    syncInterval: 300000,
    encryptKey: '',
    localFileSync: {},
    webDav: {},
    superSync: {},
  };

  private _matDialogRef =
    inject<MatDialogRef<DialogSyncInitialCfgComponent>>(MatDialogRef);

  private _subs = new Subscription();

  constructor() {
    this._subs.add(
      this.syncConfigService.syncSettingsForm$.pipe(first()).subscribe((v) => {
        if (v.isEnabled) {
          this.isWasEnabled.set(true);
          this.fields.set(this._getFields(true));
        }
        this.updateTmpCfg({
          ...v,
          isEnabled: true,
        });
      }),
    );
  }

  ngAfterViewInit(): void {
    // Setup provider change listener after the form is initialized by Formly
    // Using setTimeout to ensure the form control exists
    setTimeout(() => {
      const syncProviderControl = this.form.get('syncProvider');
      if (!syncProviderControl) {
        SyncLog.warn('syncProvider form control not found');
        return;
      }

      // Listen for provider changes and reload provider-specific configuration
      this._subs.add(
        syncProviderControl.valueChanges
          .pipe(skip(1))
          .subscribe(async (newProvider: LegacySyncProvider | null) => {
            if (!newProvider) {
              return;
            }

            // Get the current configuration for this provider
            const providerId = toSyncProviderId(newProvider);
            if (!providerId) {
              return;
            }

            // Load the provider's stored configuration
            const provider = this._providerManager.getProviderById(providerId);
            if (!provider) {
              // Provider not yet configured, keep current form state
              return;
            }

            const privateCfg = await provider.privateCfg.load();
            const globalCfg = await this._globalConfigService.sync$
              .pipe(first())
              .toPromise();

            // Create provider-specific config based on provider type
            let providerSpecificUpdate: Partial<SyncConfig> = {};

            if (newProvider === LegacySyncProvider.SuperSync && privateCfg) {
              providerSpecificUpdate = {
                superSync: privateCfg as any,
                encryptKey: privateCfg.encryptKey || '',
              };
            } else if (newProvider === LegacySyncProvider.WebDAV && privateCfg) {
              providerSpecificUpdate = {
                webDav: privateCfg as any,
                encryptKey: privateCfg.encryptKey || '',
              };
            } else if (newProvider === LegacySyncProvider.LocalFile && privateCfg) {
              providerSpecificUpdate = {
                localFileSync: privateCfg as any,
                encryptKey: privateCfg.encryptKey || '',
              };
            } else if (newProvider === LegacySyncProvider.Dropbox && privateCfg) {
              providerSpecificUpdate = {
                encryptKey: privateCfg.encryptKey || '',
              };
            }

            // Update the model, preserving non-provider-specific fields
            this._tmpUpdatedCfg = {
              ...this._tmpUpdatedCfg,
              ...providerSpecificUpdate,
              syncProvider: newProvider,
              // Preserve global settings
              isEnabled: this._tmpUpdatedCfg.isEnabled,
              syncInterval: globalCfg?.syncInterval || this._tmpUpdatedCfg.syncInterval,
              isManualSyncOnly:
                globalCfg?.isManualSyncOnly || this._tmpUpdatedCfg.isManualSyncOnly,
              isCompressionEnabled:
                globalCfg?.isCompressionEnabled ||
                this._tmpUpdatedCfg.isCompressionEnabled,
            };

            // For non-SuperSync providers, update encryption from global config
            if (newProvider !== LegacySyncProvider.SuperSync) {
              this._tmpUpdatedCfg = {
                ...this._tmpUpdatedCfg,
                isEncryptionEnabled: globalCfg?.isEncryptionEnabled || false,
              };
            }
          }),
      );
    }, 0);
  }

  close(): void {
    this._matDialogRef.close();
  }

  async save(): Promise<void> {
    console.log('[SYNC_DEBUG] Save method called', {
      formValid: this.form.valid,
      formStatus: this.form.status,
    });

    // Check if form is valid
    if (!this.form.valid) {
      // Mark all fields as touched to show validation errors
      this.form.markAllAsTouched();
      SyncLog.err('Sync form validation failed', this.form.errors);
      console.log('[SYNC_DEBUG] Form validation failed', {
        errors: this.form.errors,
        controls: Object.keys(this.form.controls).map((key) => ({
          key,
          valid: this.form.controls[key].valid,
          errors: this.form.controls[key].errors,
          value: this.form.controls[key].value,
        })),
      });
      return;
    }

    // DIAGNOSTIC: Log what we have before merge
    console.log('[SYNC_DEBUG] Before merge:', {
      _tmpUpdatedCfg: JSON.parse(JSON.stringify(this._tmpUpdatedCfg)),
      formValue: JSON.parse(JSON.stringify(this.form.value)),
      formRawValue: JSON.parse(JSON.stringify(this.form.getRawValue())),
    });

    // Explicitly sync form values to _tmpUpdatedCfg in case modelChange didn't fire
    // This is especially important on Android WebView where change detection can be unreliable
    this._tmpUpdatedCfg = {
      ...this._tmpUpdatedCfg,
      ...this.form.value,
    };

    // DIAGNOSTIC: Log what we're about to save
    const configToSave = {
      ...this._tmpUpdatedCfg,
      isEnabled: this._tmpUpdatedCfg.isEnabled || !this.isWasEnabled(),
    };
    console.log('[SYNC_DEBUG] Config to save:', JSON.parse(JSON.stringify(configToSave)));

    await this.syncConfigService.updateSettingsFromForm(configToSave, true);
    const providerId = toSyncProviderId(this._tmpUpdatedCfg.syncProvider);
    if (providerId && this._tmpUpdatedCfg.isEnabled) {
      await this.syncWrapperService.configuredAuthForSyncProviderIfNecessary(providerId);
    }

    this._matDialogRef.close();
  }

  updateTmpCfg(cfg: SyncConfig): void {
    this._tmpUpdatedCfg = cfg;
  }
}
