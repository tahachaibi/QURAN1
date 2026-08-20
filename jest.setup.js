/**
 * Test setup for the React Native project.
 *
 * @expo/vector-icons reaches into expo-font's runtime registry when it
 * constructs, which does not exist under react-test-renderer. Icons carry no
 * logic worth testing, so they are stubbed to a plain Text node — the tree shape
 * and every accessibility label stay intact.
 */
/* eslint-env jest */
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const React = require('react');
  const makeIcon = (family) => {
    const Icon = ({ name, size, color, ...rest }) =>
      React.createElement(Text, { ...rest, accessible: false }, `[${family}:${name}]`);
    Icon.glyphMap = {};
    Icon.loadFont = () => Promise.resolve();
    return Icon;
  };
  return {
    Ionicons: makeIcon('ion'),
    MaterialIcons: makeIcon('material'),
    MaterialCommunityIcons: makeIcon('mc'),
    FontAwesome: makeIcon('fa'),
    Feather: makeIcon('feather'),
  };
});
