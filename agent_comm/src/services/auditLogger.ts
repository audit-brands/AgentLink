import { EventEmitter } from 'events';
import { AuthToken } from './authManager';

export interface AuditLogEntry {
    id: string;
    timestamp: Date;
    action: string;
    agentId: string;
    roles: string[];
    resource: string;
    resourceId?: string;
    status: 'success' | 'failure';
    details?: Record<string, unknown>;
    error?: string;
    metadata: {
        ip?: string;
        userAgent?: string;
        [key: string]: unknown;
    };
}

export interface AuditLogOptions {
    storageDir?: string;
    retentionDays?: number;
    maxFileSize?: number; // in bytes
}

export class AuditLogger extends EventEmitter {
    private readonly options: Required<AuditLogOptions>;
    private currentLogFile: string;
    private currentFileSize: number;

    constructor(options: AuditLogOptions = {}) {
        super();
        this.options = {
            storageDir: options.storageDir || './logs/audit',
            retentionDays: options.retentionDays || 90,
            maxFileSize: options.maxFileSize || 10 * 1024 * 1024 // 10MB default
        };
        this.currentLogFile = this.initializeLogFile();
        this.currentFileSize = 0;
        this.setupRotation();
    }

    /**
     * Logs an orchestration action
     */
    public async logOrchestrationAction(
        action: string,
        auth: AuthToken,
        resource: string,
        resourceId: string | undefined,
        status: 'success' | 'failure',
        details?: Record<string, unknown>,
        error?: Error | string,
        metadata: Record<string, unknown> = {}
    ): Promise<void> {
        const entry: AuditLogEntry = {
            id: this.generateEntryId(),
            timestamp: new Date(),
            action,
            agentId: auth.agentId,
            roles: auth.roles,
            resource,
            resourceId,
            status,
            details,
            error: error ? (error instanceof Error ? error.message : error) : undefined,
            metadata: {
                ...metadata,
                tokenId: auth.id
            }
        };

        await this.writeEntry(entry);
        this.emit('audit:logged', entry);

        // Additional handling for security-related events
        if (status === 'failure' && this.isSecurityRelevant(action)) {
            this.emit('audit:security', entry);
        }
    }

    /**
     * Logs an authentication event
     */
    public async logAuthEvent(
        action: 'login' | 'logout' | 'token_refresh' | 'token_revoked',
        agentId: string,
        status: 'success' | 'failure',
        error?: Error | string,
        metadata: Record<string, unknown> = {}
    ): Promise<void> {
        const entry: AuditLogEntry = {
            id: this.generateEntryId(),
            timestamp: new Date(),
            action: `auth:${action}`,
            agentId,
            roles: [], // Roles not available for auth events
            resource: 'auth',
            status,
            error: error ? (error instanceof Error ? error.message : error) : undefined,
            metadata
        };

        await this.writeEntry(entry);
        this.emit('audit:auth', entry);

        if (status === 'failure') {
            this.emit('audit:security', entry);
        }
    }

    /**
     * Retrieves audit logs within a time range
     */
    public async queryLogs(
        startTime: Date,
        endTime: Date,
        filters: {
            agentId?: string;
            action?: string;
            resource?: string;
            status?: 'success' | 'failure';
        } = {}
    ): Promise<AuditLogEntry[]> {
        // In a real implementation, this would query a database or parse log files
        // For now, we'll return an empty array
        return [];
    }

    private generateEntryId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    private async writeEntry(entry: AuditLogEntry): Promise<void> {
        const serialized = JSON.stringify(entry) + '\n';
        const size = Buffer.from(serialized).length;

        // Check if adding this entry would exceed the limit
        if (this.currentFileSize + size > this.options.maxFileSize) {
            await this.rotateLog();
        }

        // In a real implementation, this would write to a file or database
        console.log('Audit Log:', serialized);
        
        // Update size only if we haven't rotated
        if (this.currentFileSize + size <= this.options.maxFileSize) {
            this.currentFileSize += size;
        }
    }

    private initializeLogFile(): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `audit-${timestamp}.log`;
    }

    private async rotateLog(): Promise<void> {
        this.currentLogFile = this.initializeLogFile();
        this.currentFileSize = 0; // Reset size after rotation
        this.emit('audit:rotated', this.currentLogFile);
    }

    private setupRotation(): void {
        // Set up daily log rotation at midnight
        setInterval(() => {
            const now = new Date();
            if (now.getHours() === 0 && now.getMinutes() === 0) {
                this.rotateLog();
            }
        }, 60000); // Check every minute
    }

    private isSecurityRelevant(action: string): boolean {
        const securityActions = [
            'auth:',
            'role:',
            'permission:',
            'workflow:create',
            'workflow:delete',
            'agent:manage'
        ];
        return securityActions.some(prefix => action.startsWith(prefix));
    }
}