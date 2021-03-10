import type { Config } from '@jest/types'

export default async (): Promise<Config.InitialOptions> => {
  return {
    verbose: true,
    preset: 'jest-puppeteer',
    transform: {
      '^.+\\.ts?$': 'ts-jest'
    },
    globalSetup: '<rootDir>/global/setup.js',
    globalTeardown: '<rootDir>/global/teardown.js',
    testEnvironment: '<rootDir>/global/puppeteer_environment.js'
  }
}
