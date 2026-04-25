module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
    testMatch: ['**/__tests__/**/*.test.ts'],
    moduleNameMapper: {
        // chalk v5 ships ESM-only; reuse the common-side stub.
        '^chalk$': '<rootDir>/../common/src/__mocks__/chalk.ts',
    },
}
