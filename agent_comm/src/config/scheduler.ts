/**
 * Task scheduler configuration for workflow optimization
 */
export const taskSchedulerConfig = {
    // Maximum number of concurrent tasks
    maxConcurrentTasks: 3,

    // Default maximum retry attempts for failed tasks
    defaultMaxRetries: 3,

    // Delay between retry attempts (milliseconds)
    retryDelayMs: 1000,

    // Task execution timeout (milliseconds)
    taskTimeoutMs: 5000,

    // Priority levels
    priorities: {
        LOW: 1,
        MEDIUM: 2,
        HIGH: 3,
        CRITICAL: 4
    },

    // Memory estimation defaults (bytes)
    memoryEstimates: {
        small: 256 * 1024 * 1024,    // 256MB
        medium: 512 * 1024 * 1024,   // 512MB
        large: 1024 * 1024 * 1024,   // 1GB
        xlarge: 2 * 1024 * 1024 * 1024 // 2GB
    }
};