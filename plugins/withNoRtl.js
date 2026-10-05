/**
 * Keep the layout left-to-right on every phone, whatever its system language.
 *
 * React Native mirrors the whole app when the phone's language is right-to-left
 * AND the manifest says android:supportsRtl="true", which Expo's template does.
 * On a phone set to Arabic that flipped the header, the tab bar and the swipe
 * direction of the mushaf pages, while the app's own language could still be
 * English. The language setting chooses the WORDS; the layout stays one way,
 * and Arabic text still runs right-to-left inside it. (I18nUtil.isRTL checks
 * this flag first, so it takes effect from the very first launch, unlike
 * I18nManager.allowRTL, which is only read on the next cold start.)
 */
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

module.exports = function withNoRtl(config) {
  return withAndroidManifest(config, (c) => {
    AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults).$['android:supportsRtl'] = 'false';
    return c;
  });
};
