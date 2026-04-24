// e2e jest config — runs against a live docker-compose stack.
// Kept separate from per-package jest configs so it only fires when
// invoked explicitly via `npm run test:e2e`.
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests/e2e'],
    testMatch: ['**/*.test.ts'],
    testTimeout: 120_000,
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.base.json' }],
    },
}
