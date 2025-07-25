import { ResourceRequest } from '../services/enhancedResourceManager';

export enum WorkflowStatus {
    PENDING = 'PENDING',
    RUNNING = 'RUNNING',
    PAUSED = 'PAUSED',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
    ROLLING_BACK = 'ROLLING_BACK',
    ROLLED_BACK = 'ROLLED_BACK'
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
    execute: (variables: Record<string, any>) => Promise<any>;
    rollback?: (variables: Record<string, any>) => Promise<void>;
    errorHandler?: (error: Error, workflow: WorkflowState) => Promise<void>;
    retryPolicy?: {
        maxAttempts: number;
        backoffMultiplier: number;
        maxDelay: number;
    };
    timeout?: number;
    dependencies?: string[];
    condition?: WorkflowCondition;
    outputVariable?: string;
    continueOnError?: boolean;
    resourceRequirements?: {
        memory: number;
        cpu: number;
        priority?: WorkflowPriority;
    };
    metadata?: Record<string, any>;
}

export interface WorkflowState {
    id: string;
    definition: WorkflowDefinition;
    status: WorkflowStatus;
    currentStep: number;
    steps: Array<{
        stepId: string;
        status: WorkflowStatus;
        result: any;
        error: string | null;
        startedAt: Date;
        completedAt: Date;
        attempts?: number;
        metrics?: {
            duration: number;
            memoryUsage: number;
            cpuUsage: number;
        };
    }>;
    variables: Record<string, any>;
    priority: WorkflowPriority;
    error?: string;
    createdAt: Date;
    updatedAt: Date;
    resourceUsage: {
        memory: number;
        cpu: number;
        peakMemory: number;
        peakCpu: number;
    };
    metadata?: Record<string, any>;
}

export interface WorkflowDefinition {
    name: string;
    description?: string;
    version: string;
    steps: WorkflowStep[];
    variables?: Record<string, any>;
    maxConcurrentSteps?: number;
    timeout?: number;
    rollbackOnError?: boolean;
    rollbackOnCancel?: boolean;
    continueOnError?: boolean;
    retryPolicy?: {
        maxAttempts: number;
        backoffMultiplier: number;
        maxDelay: number;
    };
    resourceLimits?: {
        maxMemory: number;
        maxCpu: number;
        timeout: number;
    };
    metadata?: Record<string, any>;
}

export interface WorkflowExecutionOptions {
    priority?: WorkflowPriority;
    timeout?: number;
    variables?: Record<string, any>;
    lifecycleHooks?: WorkflowLifecycleHook[];
    resourceLimits?: {
        maxMemory: number;
        maxCpu: number;
    };
    metadata?: Record<string, any>;
}

export interface WorkflowLifecycleHook {
    onCreate?: (context: any) => Promise<void>;
    onStart?: (context: any) => Promise<void>;
    onStepStart?: (context: { step: WorkflowStep }) => Promise<void>;
    onStepComplete?: (context: any) => Promise<void>;
    onStepError?: (context: { error: Error }) => Promise<void>;
    onComplete?: (context: any) => Promise<void>;
    onError?: (context: { error: Error }) => Promise<void>;
    onCancel?: (context: any) => Promise<void>;
    onPause?: (context: any) => Promise<void>;
    onResume?: (context: any) => Promise<void>;
}

export interface WorkflowEvent {
    workflowId: string;
    type: string;
    timestamp: Date;
    data: any;
}

export type WorkflowCondition = (variables: Record<string, any>) => Promise<boolean>;
export type WorkflowRollback = (variables: Record<string, any>) => Promise<void>;

export interface WorkflowMetrics {
    executionTime: number;
    stepCount: number;
    completedSteps: number;
    failedSteps: number;
    averageStepDuration: number;
    resourceUsage: {
        memory: number;
        cpu: number;
        peakMemory: number;
        peakCpu: number;
    };
    status: WorkflowStatus;
    lastUpdated: Date;
}