module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
    testMatch: ['**/__tests__/**/*.test.ts'],
    // chalk v5 ships ESM-only; map to a CJS-friendly stub for tests so the
    // logger transitively imported by `application.ts` can be loaded.
    moduleNameMapper: {
        '^chalk$': '<rootDir>/src/__mocks__/chalk.ts',
    },
}
