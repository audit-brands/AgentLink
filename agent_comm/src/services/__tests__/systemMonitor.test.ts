import { SystemMonitor, AlertConfig, SystemMetrics, HealthStatus } from '../monitoring/systemMonitor';
import { EnhancedResourceManager, ResourceLimits } from '../enhancedResourceManager';

describe('SystemMonitor', () => {
    let systemMonitor: SystemMonitor;
    let resourceManager: EnhancedResourceManager;
    let config: AlertConfig;

    beforeEach(() => {
        const limits: ResourceLimits = {
            memory: {
                max: 90,
                warning: 80
            },
            cpu: {
                maxUsage: 90,
                warning: 80
            }
        };

        resourceManager = new EnhancedResourceManager(limits);
        
        config = {
            memory: {
                warning: 80,
                critical: 90
            },
            cpu: {
                warning: 80,
                critical: 90
            },
            healthCheck: {
                interval: 1000,
                timeout: 5000
            }
        };

        systemMonitor = new SystemMonitor(resourceManager, config);
    });

    afterEach(() => {
        systemMonitor.stop();
        resourceManager.stop();
        jest.clearAllMocks();
    });

    describe('Metrics Collection', () => {
        it('should collect system metrics', async () => {
            const metrics = await systemMonitor.getSystemMetrics();

            expect(metrics).toHaveProperty('timestamp');
            expect(metrics.system).toHaveProperty('uptime');
            expect(metrics.system).toHaveProperty('platform');
            expect(metrics.system).toHaveProperty('arch');
            expect(metrics.system).toHaveProperty('nodeVersion');
            expect(metrics.system).toHaveProperty('hostname');

            expect(metrics.process).toHaveProperty('pid');
            expect(metrics.process).toHaveProperty('uptime');
            expect(metrics.process).toHaveProperty('memoryUsage');
            expect(metrics.process).toHaveProperty('cpuUsage');
        });

        it('should maintain metrics history', async () => {
            // Generate some metrics
            await systemMonitor.getSystemMetrics();
            await systemMonitor.getSystemMetrics();
            await systemMonitor.getSystemMetrics();

            const history = systemMonitor.getMetricsHistory();
            expect(history).toBeInstanceOf(Array);
            expect(history.length).toBeGreaterThan(0);
        });

        it('should filter metrics history by duration', async () => {
            // Generate metrics with different timestamps
            const oldMetrics: SystemMetrics = {
                ...(await systemMonitor.getSystemMetrics()),
                timestamp: Date.now() - 10000 // 10 seconds ago
            };

            const newMetrics: SystemMetrics = {
                ...(await systemMonitor.getSystemMetrics()),
                timestamp: Date.now()
            };

            // @ts-ignore - private property access for testing
            systemMonitor.metricsHistory = [oldMetrics, newMetrics];

            const recentHistory = systemMonitor.getMetricsHistory(5000); // Last 5 seconds
            expect(recentHistory.length).toBe(1);
            expect(recentHistory[0].timestamp).toBe(newMetrics.timestamp);
        });
    });

    describe('Health Checks', () => {
        it('should perform health checks', async () => {
            const healthStatus = await systemMonitor.getHealthStatus();

            expect(healthStatus).toHaveProperty('status');
            expect(healthStatus).toHaveProperty('checks');
            expect(healthStatus).toHaveProperty('timestamp');

            expect(healthStatus.checks).toHaveProperty('memory');
            expect(healthStatus.checks).toHaveProperty('cpu');
            expect(healthStatus.checks).toHaveProperty('uptime');
        });

        it('should emit health events', (done) => {
            systemMonitor.on('health', (status: HealthStatus) => {
                expect(status).toHaveProperty('status');
                expect(status).toHaveProperty('checks');
                expect(status.checks).toHaveProperty('memory');
                expect(status.checks).toHaveProperty('cpu');
                done();
            });

            systemMonitor.start();
        });

        it('should handle resource alerts', (done) => {
            systemMonitor.on('alert', (alert) => {
                expect(alert).toHaveProperty('type');
                expect(alert).toHaveProperty('severity');
                expect(alert).toHaveProperty('message');
                expect(alert).toHaveProperty('timestamp');
                done();
            });

            // Simulate a resource alert
            resourceManager.emit('alert', {
                type: 'memory',
                level: 'warning',
                message: 'Memory usage high',
                timestamp: new Date()
            });
        });
    });

    describe('Lifecycle Management', () => {
        it('should start and stop monitoring', () => {
            systemMonitor.start();
            expect(systemMonitor['healthCheckInterval']).toBeTruthy();

            systemMonitor.stop();
            expect(systemMonitor['healthCheckInterval']).toBeNull();
        });

        it('should not create multiple intervals when starting multiple times', () => {
            systemMonitor.start();
            const firstInterval = systemMonitor['healthCheckInterval'];
            
            systemMonitor.start();
            expect(systemMonitor['healthCheckInterval']).toBe(firstInterval);
            
            systemMonitor.stop();
        });
    });

    describe('Status Level Calculation', () => {
        it('should calculate correct status levels', () => {
            // @ts-ignore - private method access for testing
            expect(systemMonitor['getStatusLevel'](70, 80, 90)).toBe('pass');
            // @ts-ignore - private method access for testing
            expect(systemMonitor['getStatusLevel'](85, 80, 90)).toBe('warn');
            // @ts-ignore - private method access for testing
            expect(systemMonitor['getStatusLevel'](95, 80, 90)).toBe('fail');
        });
    });
});