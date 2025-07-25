/**
 * Core types for the orchestration layer
 */

export interface AgentTask {
    id: string;
    method: string;
    params: Record<string, unknown>;
    sourceAgent: string;
    targetAgent: string;
    status: TaskStatus;
    createdAt: Date;
    updatedAt: Date;
    result?: unknown;
    error?: string;
}

export enum TaskStatus {
    PENDING = 'PENDING',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED'
}

export interface AgentCapability {
    name: string;
    methods: string[];
    version: string;
}

export interface RegisteredAgent {
    id: string;
    name: string;
    endpoint: string;
    capabilities: AgentCapability[];
    status: AgentStatus;
    lastSeen: Date;
}

export enum AgentStatus {
    ONLINE = 'ONLINE',
    OFFLINE = 'OFFLINE',
    BUSY = 'BUSY'
}

export interface OrchestrationConfig {
    taskQueueSize: number;
    taskTimeout: number;
    retryAttempts: number;
    retryDelay: number;
}

export interface TaskQueue {
    enqueue(task: AgentTask): Promise<void>;
    dequeue(): Promise<AgentTask | null>;
    peek(): Promise<AgentTask | null>;
    size(): Promise<number>;
    getTask(taskId: string): Promise<AgentTask | null>;
    updateTask(task: AgentTask): Promise<void>;
}

export interface AgentRegistry {
    register(agent: RegisteredAgent): Promise<void>;
    unregister(agentId: string): Promise<void>;
    getAgent(agentId: string): Promise<RegisteredAgent | null>;
    listAgents(): Promise<RegisteredAgent[]>;
    updateStatus(agentId: string, status: AgentStatus): Promise<void>;
}

export interface TaskRouter {
    route(task: AgentTask): Promise<string>; // Returns target agent ID
    canHandle(task: AgentTask): Promise<boolean>;
}

export interface OrchestrationMetrics {
    taskCount: number;
    completedTasks: number;
    failedTasks: number;
    averageProcessingTime: number;
    activeAgents: number;
}

export interface Orchestrator {
    submitTask(task: Partial<AgentTask>): Promise<string>; // Returns task ID
    getTaskStatus(taskId: string): Promise<TaskStatus>;
    cancelTask(taskId: string): Promise<boolean>;
    getMetrics(): Promise<OrchestrationMetrics>;
}