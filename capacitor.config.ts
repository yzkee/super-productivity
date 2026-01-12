import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.superproductivity.superproductivity',
  appName: 'Super Productivity',
  webDir: 'dist/browser',
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    LocalNotifications: {
      // Android-specific: small icon for notification
      smallIcon: 'ic_stat_sp',
    },
  },
  ios: {
    // Content inset for safe areas (notch, home indicator)
    contentInset: 'automatic',
    // Allow inline media playback
    allowsLinkPreview: true,
    // Scroll behavior
    scrollEnabled: true,
  },
};

export default config;
