import { EnhancedResourceManager } from './enhancedResourceManager';
import { WorkflowMetrics, WorkflowState, WorkflowStatus } from '../types/workflow';

export class WorkflowMetricsService {
    private resourceManager: EnhancedResourceManager;
    private metrics: Map<string, WorkflowMetrics>;
    private startTimes: Map<string, number>;
    private resourceSnapshots: Map<string, Array<{
        timestamp: number;
        cpu: number;
        memory: number;
    }>>;

    constructor(resourceManager: EnhancedResourceManager) {
        this.resourceManager = resourceManager;
        this.metrics = new Map();
        this.startTimes = new Map();
        this.resourceSnapshots = new Map();
    }

    public initializeWorkflow(workflowId: string): void {
        this.startTimes.set(workflowId, Date.now());
        this.resourceSnapshots.set(workflowId, []);
        this.metrics.set(workflowId, {
            totalWorkflows: 1,
            activeWorkflows: 1,
            completedWorkflows: 0,
            failedWorkflows: 0,
            averageCompletionTime: 0,
            resourceUtilization: {
                cpu: {
                    current: 0,
                    average: 0,
                    peak: 0
                },
                memory: {
                    current: 0,
                    average: 0,
                    peak: 0
                }
            }
        });
    }

    public async updateMetrics(workflowId: string, state: WorkflowState): Promise<void> {
        const metrics = this.metrics.get(workflowId);
        if (!metrics) return;

        // Update resource utilization
        const currentMetrics = await this.resourceManager.getEnhancedMetrics();
        const utilization = this.resourceManager.getResourceUtilization();

        const snapshot = {
            timestamp: Date.now(),
            cpu: utilization.cpu,
            memory: utilization.memory
        };

        const snapshots = this.resourceSnapshots.get(workflowId) || [];
        snapshots.push(snapshot);
        this.resourceSnapshots.set(workflowId, snapshots);

        // Calculate averages and peaks
        const cpuValues = snapshots.map(s => s.cpu);
        const memoryValues = snapshots.map(s => s.memory);

        metrics.resourceUtilization = {
            cpu: {
                current: utilization.cpu,
                average: cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length,
                peak: Math.max(...cpuValues)
            },
            memory: {
                current: utilization.memory,
                average: memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length,
                peak: Math.max(...memoryValues)
            }
        };

        // Update workflow status metrics
        if (state.status === WorkflowStatus.COMPLETED) {
            metrics.completedWorkflows++;
            metrics.activeWorkflows--;
            this.updateCompletionTime(workflowId, metrics);
        } else if (state.status === WorkflowStatus.FAILED) {
            metrics.failedWorkflows++;
            metrics.activeWorkflows--;
            this.updateCompletionTime(workflowId, metrics);
        }

        this.metrics.set(workflowId, metrics);
    }

    private updateCompletionTime(workflowId: string, metrics: WorkflowMetrics): void {
        const startTime = this.startTimes.get(workflowId);
        if (startTime) {
            const duration = Date.now() - startTime;
            const totalCompleted = metrics.completedWorkflows + metrics.failedWorkflows;
            const oldAverage = metrics.averageCompletionTime * (totalCompleted - 1);
            metrics.averageCompletionTime = (oldAverage + duration) / totalCompleted;
        }
    }

    public getMetrics(workflowId: string): WorkflowMetrics | null {
        return this.metrics.get(workflowId) || null;
    }

    public checkResourceWarnings(workflowId: string): {
        warnings: string[];
        critical: string[];
    } {
        const metrics = this.metrics.get(workflowId);
        if (!metrics) {
            return { warnings: [], critical: [] };
        }

        const warnings: string[] = [];
        const critical: string[] = [];

        const { cpu, memory } = metrics.resourceUtilization;

        if (cpu.current >= 70 && cpu.current < 80) {
            warnings.push(`CPU utilization at warning level: ${cpu.current}%`);
        } else if (cpu.current >= 80) {
            critical.push(`CPU utilization at critical level: ${cpu.current}%`);
        }

        if (memory.current >= 70 && memory.current < 80) {
            warnings.push(`Memory utilization at warning level: ${memory.current}%`);
        } else if (memory.current >= 80) {
            critical.push(`Memory utilization at critical level: ${memory.current}%`);
        }

        return { warnings, critical };
    }

    public cleanup(workflowId: string): void {
        this.metrics.delete(workflowId);
        this.startTimes.delete(workflowId);
        this.resourceSnapshots.delete(workflowId);
    }
}