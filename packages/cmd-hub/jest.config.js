module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    moduleNameMapper: {
        '^@core/(.*)$': '<rootDir>/src/$1',
        '^@logger$': '<rootDir>/src/application/logger',
        '^@config$': '<rootDir>/src/config',
        '^@utils/(.*)$': '<rootDir>/src/utils/$1',
        '^@cmd-hub/common$': '<rootDir>/../cmd-hub-common/src/index.ts',
        '^@cmd-hub/common/(.*)$': '<rootDir>/../cmd-hub-common/src/$1',
    },
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: 'tsconfig.json',
        }],
    },
    testMatch: ['**/__tests__/**/*.test.ts'],
}
