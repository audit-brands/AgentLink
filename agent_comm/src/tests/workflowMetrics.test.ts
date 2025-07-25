import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowMetricsService } from '../services/workflowMetrics';
import { EnhancedResourceManager } from '../services/enhancedResourceManager';
import { ResourceLimits } from '../services/resourceManager';
import { WorkflowState, WorkflowStatus } from '../types/workflow';

describe('WorkflowMetricsService', () => {
    let metricsService: WorkflowMetricsService;
    let resourceManager: EnhancedResourceManager;

    const mockLimits: ResourceLimits = {
        memory: {
            max: 1024 * 1024 * 1024, // 1GB
            warning: 768 * 1024 * 1024, // 768MB
        },
        cpu: {
            maxUsage: 80, // 80%
            warning: 70, // 70%
        },
    };

    beforeEach(() => {
        resourceManager = new EnhancedResourceManager(mockLimits);
        metricsService = new WorkflowMetricsService(resourceManager);
    });

    describe('Metrics Tracking', () => {
        it('should initialize workflow metrics', () => {
            const workflowId = 'test-workflow';
            metricsService.initializeWorkflow(workflowId);

            const metrics = metricsService.getMetrics(workflowId);
            expect(metrics).toBeDefined();
            expect(metrics?.activeWorkflows).toBe(1);
            expect(metrics?.completedWorkflows).toBe(0);
        });

        it('should update metrics on workflow completion', async () => {
            const workflowId = 'test-workflow';
            metricsService.initializeWorkflow(workflowId);

            vi.spyOn(resourceManager, 'getEnhancedMetrics').mockResolvedValue({
                memory: {
                    total: mockLimits.memory.max,
                    used: 512 * 1024 * 1024,
                    free: mockLimits.memory.max - 512 * 1024 * 1024,
                    processUsage: 512 * 1024 * 1024,
                    heapUsage: 512 * 1024 * 1024
                },
                cpu: {
                    usage: 50,
                    loadAvg: [50, 50, 50],
                    processUsage: 50
                },
                storage: {
                    used: 0,
                    free: 1000
                },
                availableResources: {
                    memory: mockLimits.memory.max - 512 * 1024 * 1024,
                    cpu: 30
                },
                utilizationPercentages: {
                    memory: 50,
                    cpu: 50
                }
            });

            vi.spyOn(resourceManager, 'getResourceUtilization').mockReturnValue({
                memory: 50,
                cpu: 50
            });

            const mockState: WorkflowState = {
                id: workflowId,
                definition: {
                    name: 'Test Workflow',
                    version: '1.0.0',
                    steps: []
                },
                status: WorkflowStatus.COMPLETED,
                currentStep: 0,
                steps: [],
                variables: {},
                createdAt: new Date(),
                updatedAt: new Date()
            };

            await metricsService.updateMetrics(workflowId, mockState);

            const metrics = metricsService.getMetrics(workflowId);
            expect(metrics?.completedWorkflows).toBe(1);
            expect(metrics?.activeWorkflows).toBe(0);
            expect(metrics?.resourceUtilization.cpu.current).toBe(50);
        });
    });

    describe('Resource Warnings', () => {
        it('should detect warning level resource usage', async () => {
            const workflowId = 'test-workflow';
            metricsService.initializeWorkflow(workflowId);

            vi.spyOn(resourceManager, 'getEnhancedMetrics').mockResolvedValue({
                memory: {
                    total: mockLimits.memory.max,
                    used: 768 * 1024 * 1024,
                    free: mockLimits.memory.max - 768 * 1024 * 1024,
                    processUsage: 768 * 1024 * 1024,
                    heapUsage: 768 * 1024 * 1024
                },
                cpu: {
                    usage: 75,
                    loadAvg: [75, 75, 75],
                    processUsage: 75
                },
                storage: {
                    used: 0,
                    free: 1000
                },
                availableResources: {
                    memory: mockLimits.memory.max - 768 * 1024 * 1024,
                    cpu: 5
                },
                utilizationPercentages: {
                    memory: 75,
                    cpu: 75
                }
            });

            vi.spyOn(resourceManager, 'getResourceUtilization').mockReturnValue({
                memory: 75,
                cpu: 75
            });

            const mockState: WorkflowState = {
                id: workflowId,
                definition: {
                    name: 'Test Workflow',
                    version: '1.0.0',
                    steps: []
                },
                status: WorkflowStatus.RUNNING,
                currentStep: 0,
                steps: [],
                variables: {},
                createdAt: new Date(),
                updatedAt: new Date()
            };

            await metricsService.updateMetrics(workflowId, mockState);
            const { warnings, critical } = metricsService.checkResourceWarnings(workflowId);

            expect(warnings.length).toBeGreaterThan(0);
            expect(critical.length).toBe(0);
        });

        it('should detect critical level resource usage', async () => {
            const workflowId = 'test-workflow';
            metricsService.initializeWorkflow(workflowId);

            vi.spyOn(resourceManager, 'getEnhancedMetrics').mockResolvedValue({
                memory: {
                    total: mockLimits.memory.max,
                    used: 900 * 1024 * 1024,
                    free: mockLimits.memory.max - 900 * 1024 * 1024,
                    processUsage: 900 * 1024 * 1024,
                    heapUsage: 900 * 1024 * 1024
                },
                cpu: {
                    usage: 85,
                    loadAvg: [85, 85, 85],
                    processUsage: 85
                },
                storage: {
                    used: 0,
                    free: 1000
                },
                availableResources: {
                    memory: mockLimits.memory.max - 900 * 1024 * 1024,
                    cpu: -5
                },
                utilizationPercentages: {
                    memory: 85,
                    cpu: 85
                }
            });

            vi.spyOn(resourceManager, 'getResourceUtilization').mockReturnValue({
                memory: 85,
                cpu: 85
            });

            const mockState: WorkflowState = {
                id: workflowId,
                definition: {
                    name: 'Test Workflow',
                    version: '1.0.0',
                    steps: []
                },
                status: WorkflowStatus.RUNNING,
                currentStep: 0,
                steps: [],
                variables: {},
                createdAt: new Date(),
                updatedAt: new Date()
            };

            await metricsService.updateMetrics(workflowId, mockState);
            const { warnings, critical } = metricsService.checkResourceWarnings(workflowId);

            expect(warnings.length).toBe(0);
            expect(critical.length).toBeGreaterThan(0);
        });
    });

    describe('Cleanup', () => {
        it('should clean up workflow metrics', () => {
            const workflowId = 'test-workflow';
            metricsService.initializeWorkflow(workflowId);
            
            expect(metricsService.getMetrics(workflowId)).toBeDefined();
            
            metricsService.cleanup(workflowId);
            expect(metricsService.getMetrics(workflowId)).toBeNull();
        });
    });
});