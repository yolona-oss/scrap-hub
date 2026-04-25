module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
    testMatch: ['**/__tests__/**/*.test.ts'],
    // chalk v5 is ESM-only; map to the cmd-hub-common CJS stub so the
    // logger transitively pulled in by `manifest-aggregator.ts` loads.
    moduleNameMapper: {
        '^chalk$': '<rootDir>/../cmd-hub-common/src/__mocks__/chalk.ts',
    },
}
