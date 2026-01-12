import { inject, Injectable } from '@angular/core';
import { LocalNotifications, ScheduleOptions } from '@capacitor/local-notifications';
import { Log } from '../log';
import { CapacitorPlatformService } from './capacitor-platform.service';

export interface ScheduleNotificationOptions {
  id: number;
  title: string;
  body: string;
  /**
   * When to show the notification. If not provided, shows immediately.
   */
  scheduleAt?: Date;
  /**
   * Extra data to attach to the notification
   */
  extra?: Record<string, unknown>;
  /**
   * Whether to allow notification when device is idle (Android)
   */
  allowWhileIdle?: boolean;
}

/**
 * Service for managing local notifications via Capacitor.
 *
 * This service provides a unified interface for scheduling and canceling
 * local notifications on iOS and Android.
 */
@Injectable({
  providedIn: 'root',
})
export class CapacitorNotificationService {
  private _platformService = inject(CapacitorPlatformService);

  /**
   * Check if notifications are available on this platform
   */
  get isAvailable(): boolean {
    return this._platformService.capabilities.scheduledNotifications;
  }

  /**
   * Request notification permissions from the user
   */
  async requestPermissions(): Promise<boolean> {
    if (!this.isAvailable) {
      return false;
    }

    try {
      const result = await LocalNotifications.requestPermissions();
      return result.display === 'granted';
    } catch (error) {
      Log.err('CapacitorNotificationService: Failed to request permissions', error);
      return false;
    }
  }

  /**
   * Check current notification permission status
   */
  async checkPermissions(): Promise<boolean> {
    if (!this.isAvailable) {
      return false;
    }

    try {
      const result = await LocalNotifications.checkPermissions();
      return result.display === 'granted';
    } catch (error) {
      Log.err('CapacitorNotificationService: Failed to check permissions', error);
      return false;
    }
  }

  /**
   * Ensure permissions are granted, requesting if necessary
   */
  async ensurePermissions(): Promise<boolean> {
    const hasPermission = await this.checkPermissions();
    if (hasPermission) {
      return true;
    }
    return this.requestPermissions();
  }

  /**
   * Schedule a local notification
   */
  async schedule(options: ScheduleNotificationOptions): Promise<boolean> {
    if (!this.isAvailable) {
      Log.warn(
        'CapacitorNotificationService: Notifications not available on this platform',
      );
      return false;
    }

    const hasPermission = await this.ensurePermissions();
    if (!hasPermission) {
      Log.warn('CapacitorNotificationService: Notification permission not granted');
      return false;
    }

    try {
      const scheduleOptions: ScheduleOptions = {
        notifications: [
          {
            id: options.id,
            title: options.title,
            body: options.body,
            extra: options.extra,
            schedule: options.scheduleAt
              ? {
                  at: options.scheduleAt,
                  allowWhileIdle: options.allowWhileIdle ?? true,
                }
              : {
                  // Schedule for 1 second from now for immediate notifications
                  at: new Date(Date.now() + 1000),
                  allowWhileIdle: options.allowWhileIdle ?? true,
                },
          },
        ],
      };

      await LocalNotifications.schedule(scheduleOptions);

      Log.log('CapacitorNotificationService: Notification scheduled', {
        id: options.id,
        title: options.title,
        scheduleAt: options.scheduleAt,
      });

      return true;
    } catch (error) {
      Log.err('CapacitorNotificationService: Failed to schedule notification', error);
      return false;
    }
  }

  /**
   * Cancel a scheduled notification by ID
   */
  async cancel(notificationId: number): Promise<boolean> {
    if (!this.isAvailable) {
      return false;
    }

    try {
      await LocalNotifications.cancel({
        notifications: [{ id: notificationId }],
      });

      Log.log('CapacitorNotificationService: Notification cancelled', {
        id: notificationId,
      });

      return true;
    } catch (error) {
      Log.err('CapacitorNotificationService: Failed to cancel notification', error);
      return false;
    }
  }

  /**
   * Cancel multiple scheduled notifications
   */
  async cancelMultiple(notificationIds: number[]): Promise<boolean> {
    if (!this.isAvailable || notificationIds.length === 0) {
      return false;
    }

    try {
      await LocalNotifications.cancel({
        notifications: notificationIds.map((id) => ({ id })),
      });

      Log.log('CapacitorNotificationService: Notifications cancelled', {
        ids: notificationIds,
      });

      return true;
    } catch (error) {
      Log.err('CapacitorNotificationService: Failed to cancel notifications', error);
      return false;
    }
  }

  /**
   * Get all pending notifications
   */
  async getPending(): Promise<{ id: number }[]> {
    if (!this.isAvailable) {
      return [];
    }

    try {
      const result = await LocalNotifications.getPending();
      return result.notifications;
    } catch (error) {
      Log.err('CapacitorNotificationService: Failed to get pending notifications', error);
      return [];
    }
  }

  /**
   * Register a listener for notification actions
   */
  async addActionListener(
    callback: (notification: { id: number; extra?: Record<string, unknown> }) => void,
  ): Promise<void> {
    if (!this.isAvailable) {
      return;
    }

    await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      callback({
        id: event.notification.id,
        extra: event.notification.extra,
      });
    });
  }

  /**
   * Remove all notification listeners
   */
  async removeAllListeners(): Promise<void> {
    if (!this.isAvailable) {
      return;
    }

    await LocalNotifications.removeAllListeners();
  }
}
