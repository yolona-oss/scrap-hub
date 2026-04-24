module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    moduleNameMapper: {
        // Map cmd-hub internal aliases so tests can load its runtime without
        // tripping over the compiled JS's unresolved paths.
        '^@core/(.*)$':  '<rootDir>/../cmd-hub/src/$1',
        '^@logger$':     '<rootDir>/../cmd-hub/src/application/logger',
        '^@config$':     '<rootDir>/../cmd-hub/src/config',
        '^@utils/(.*)$': '<rootDir>/../cmd-hub/src/utils/$1',
        // Production code imports only from specific '@core/*' paths, never from
        // the '@cmd-hub/core' barrel (which transitively drags ESM-only deps).
        // See packages/cmd-node/src/runtime/hub-client.ts for the pattern.
    },
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
    testMatch: ['**/__tests__/**/*.test.ts'],
}
