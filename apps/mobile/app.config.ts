import type { ConfigContext, ExpoConfig } from 'expo/config';

// Bundle identifiers (iOS) and package name (Android) are intentionally absent:
// they are a prerequisite owned by Randy (plan section 11) and are not invented here.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'YZY Contracts',
  slug: 'yzy-contracts',
  scheme: 'yzycontracts',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  backgroundColor: '#eceef4',
  ios: {
    supportsTablet: false,
    // Local device builds only; the store bundle ID is still Randy's decision.
    bundleIdentifier: process.env.YZY_IOS_BUNDLE_ID,
    appleTeamId: process.env.YZY_APPLE_TEAM_ID,
  },
  android: {
    // Local device builds only; the store package name is still Randy's decision.
    package: process.env.YZY_ANDROID_PACKAGE,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#2a3084',
    },
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#eceef4',
        image: './assets/splash-icon.png',
        imageWidth: 180,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
});
