/**
 * Two projects on purpose:
 *  - "engine" runs the pure matching engine under ts-jest in plain Node. No
 *    React Native transform, no jsdom: these tests are the ones iterated on
 *    most, so they must stay fast (they load the real 77k-word Quran array).
 *  - "app" runs anything that touches React Native through jest-expo.
 */
module.exports = {
  projects: [
    {
      displayName: 'engine',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
      // Binary assets are numbers under Metro and nothing at all under Node, so
      // they are stubbed: pure logic must not become untestable because a module
      // it imports mentions an audio file.
      moduleNameMapper: {
        '\\.(mp3|wav|otf|ttf|png|jpg|jpeg|gif|svg)$': '<rootDir>/__tests__/assetStub.js',
      },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true, resolveJsonModule: true, strict: true, target: 'es2020', jsx: 'react-jsx' } }],
      },
    },
    {
      displayName: 'app',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/__tests__/**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    },
  ],
};
