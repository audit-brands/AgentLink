import { EventEmitter } from 'events';

export enum WorkflowStatus {
    PENDING = 'pending',
    RUNNING = 'running',
    COMPLETED = 'completed',
    FAILED = 'failed',
    PAUSED = 'paused',
    CANCELLED = 'cancelled',
    ROLLING_BACK = 'rolling_back',
    ROLLED_BACK = 'rolled_back'
}

export enum WorkflowPriority {
    LOW = 0,
    NORMAL = 1,
    HIGH = 2,
    CRITICAL = 3
}

export interface WorkflowStep {
    id: string;
    name: string;
    description?: string;
    execute: (variables: Record<string, any>) => Promise<unknown>;
    condition?: WorkflowCondition;
    rollback?: WorkflowRollback;
    errorHandler?: (error: unknown, workflow: WorkflowState) => Promise<void>;
    outputVariable?: string;
    continueOnError?: boolean;
    timeout?: number;
    retryPolicy?: {
        maxAttempts: number;
        backoffMultiplier: number;
        maxDelay: number;
    };
    parallel?: boolean;
    resourceRequirements?: {
        cpu: number;
        memory: number;
        priority?: WorkflowPriority;
    };
    dependencies?: string[]; // IDs of steps that must complete before this step
}

export interface WorkflowStepState {
    stepId: string;
    status: WorkflowStatus;
    result: unknown;
    error: string | null;
    startedAt: Date;
    completedAt: Date;
    attempts?: number;
    resourceUsage?: {
        cpu: number;
        memory: number;
    };
}

export interface WorkflowDefinition {
    name: string;
    description?: string;
    version: string;
    steps: WorkflowStep[];
    variables?: Record<string, any>;
    timeout?: number;
    rollbackOnError?: boolean;
    rollbackOnCancel?: boolean;
    maxConcurrentSteps?: number;
    resourceLimits?: {
        cpu: number;
        memory: number;
    };
}

export interface WorkflowState {
    id: string;
    definition: WorkflowDefinition;
    status: WorkflowStatus;
    currentStep: number;
    steps: WorkflowStepState[];
    variables: Record<string, any>;
    error?: string;
    priority?: WorkflowPriority;
    createdAt: Date;
    updatedAt: Date;
    metrics?: {
        totalDuration: number;
        stepDurations: Record<string, number>;
        resourceUsage: {
            cpu: {
                average: number;
                peak: number;
            };
            memory: {
                average: number;
                peak: number;
            };
        };
    };
}

export type WorkflowCondition = (
    variables: Record<string, any>
) => Promise<boolean> | boolean;

export type WorkflowRollback = (
    variables: Record<string, any>
) => Promise<void> | void;

export interface WorkflowEvent {
    workflowId: string;
    type: string;
    timestamp: Date;
    data?: any;
}

export interface WorkflowExecutionOptions {
    priority?: WorkflowPriority;
    timeout?: number;
    retryPolicy?: {
        maxAttempts: number;
        backoffMultiplier: number;
        maxDelay: number;
    };
    resourceLimits?: {
        cpu: number;
        memory: number;
    };
    dependencies?: string[]; // IDs of workflows that must complete before this one
}

export interface WorkflowMetrics {
    totalWorkflows: number;
    activeWorkflows: number;
    completedWorkflows: number;
    failedWorkflows: number;
    averageCompletionTime: number;
    resourceUtilization: {
        cpu: {
            current: number;
            average: number;
            peak: number;
        };
        memory: {
            current: number;
            average: number;
            peak: number;
        };
    };
}

export interface WorkflowEngine extends EventEmitter {
    createWorkflow(
        definition: WorkflowDefinition,
        options?: WorkflowExecutionOptions
    ): string;
    
    startWorkflow(workflowId: string): Promise<void>;
    pauseWorkflow(workflowId: string): Promise<void>;
    resumeWorkflow(workflowId: string): Promise<void>;
    cancelWorkflow(workflowId: string): Promise<void>;
    
    getWorkflowStatus(workflowId: string): WorkflowState | null;
    getWorkflowMetrics(workflowId: string): WorkflowMetrics | null;
    
    on(event: 'workflow:created', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:started', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:completed', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:failed', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:paused', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:resumed', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:cancelled', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:step:started', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:step:completed', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:step:failed', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:rollback:started', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:rollback:completed', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:rollback:failed', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:resource:warning', listener: (event: WorkflowEvent) => void): this;
    on(event: 'workflow:resource:critical', listener: (event: WorkflowEvent) => void): this;
}