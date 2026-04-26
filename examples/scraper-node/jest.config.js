module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
    testMatch: ['**/__tests__/**/*.test.ts'],
    moduleNameMapper: {
        // chalk v5 is ESM-only; reuse the common-side stub so build/* CJS
        // outputs imported from @cmd-hub/common can load.
        '^chalk$': '<rootDir>/../../packages/common/src/__mocks__/chalk.ts',
    },
}
