import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        testTimeout: 10000,  // 10 seconds
        hookTimeout: 10000,
        include: ['src/tests/**/*.test.ts'],
        environment: 'node',
        threads: false,
        isolate: false,
    },
});