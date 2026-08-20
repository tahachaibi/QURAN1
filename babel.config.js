module.exports = function (api) {
  api.cache(true);
  // Nothing beyond babel-preset-expo: react-native-reanimated is not used, so
  // its babel plugin (and its native build cost) is not carried either.
  return {
    presets: ['babel-preset-expo'],
  };
};
