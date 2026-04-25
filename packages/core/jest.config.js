module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    moduleNameMapper: {
        '^@core/(.*)$': '<rootDir>/src/$1',
        '^@logger$': '<rootDir>/src/application/logger',
        '^@config$': '<rootDir>/src/config',
        '^@utils/(.*)$': '<rootDir>/src/utils/$1',
        '^@cmd-hub/common$': '<rootDir>/../common/src/index.ts',
        '^@cmd-hub/common/(.*)$': '<rootDir>/../common/src/$1',
        '^@cmd-hub/transport$': '<rootDir>/../transport/src/index.ts',
        '^@cmd-hub/transport/(.*)$': '<rootDir>/../transport/src/$1',
        // chalk v5 ships ESM-only; reuse the common-side stub.
        '^chalk$': '<rootDir>/../common/src/__mocks__/chalk.ts',
    },
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: 'tsconfig.json',
        }],
    },
    testMatch: ['**/__tests__/**/*.test.ts'],
}
