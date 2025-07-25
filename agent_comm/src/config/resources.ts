/**
 * Resource management configuration for AgentLink
 */
export const resourceConfig = {
    memory: {
        // Maximum memory usage allowed (7GB to stay under 8GB target)
        max: 7 * 1024 * 1024 * 1024,
        // Warning threshold at 80% of max
        warning: 5.6 * 1024 * 1024 * 1024
    },
    cpu: {
        // Maximum CPU usage percentage
        maxUsage: 80,
        // Warning threshold at 75% of max
        warning: 60
    },
    monitoring: {
        // Check interval in milliseconds
        interval: 1000,
        // Number of samples to keep for trending
        sampleSize: 60,
        // Alert cooldown period in milliseconds
        alertCooldown: 300000 // 5 minutes
    }
};