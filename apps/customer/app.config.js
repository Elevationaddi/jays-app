// Build-time options on top of app.json (ADR-0039). The name and app ID are provisional
// (founder decision D1): nothing is registered, and both can be changed here per build without
// editing code. Firebase's google-services.json is a per-environment file that is never
// committed; point GOOGLE_SERVICES_JSON at it when building with push enabled.
module.exports = ({ config }) => {
  const name = process.env.APP_DISPLAY_NAME || config.name;
  const appId = process.env.APP_ID || config.ios.bundleIdentifier;
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  return {
    ...config,
    name,
    ios: { ...config.ios, bundleIdentifier: appId },
    android: {
      ...config.android,
      package: appId,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    plugins: [...(config.plugins ?? []), 'expo-notifications'],
  };
};
