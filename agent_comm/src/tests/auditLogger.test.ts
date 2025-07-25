import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AuditLogger, AuditLogEntry } from '../services/auditLogger';
import { AuthToken } from '../services/authManager';

describe('AuditLogger', () => {
    let auditLogger: AuditLogger;
    let mockAuthToken: AuthToken;
    let consoleSpy: any;

    beforeEach(() => {
        auditLogger = new AuditLogger({
            storageDir: './test-logs',
            retentionDays: 1,
            maxFileSize: 1024
        });

        mockAuthToken = {
            id: 'test-token-id',
            agentId: 'test-agent',
            roles: ['agent'],
            permissions: ['workflow:execute'],
            issuedAt: Date.now(),
            expiresAt: Date.now() + 3600000
        };

        consoleSpy = vi.spyOn(console, 'log');
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Orchestration Action Logging', () => {
        it('should log successful orchestration actions', async () => {
            const eventHandler = vi.fn();
            auditLogger.on('audit:logged', eventHandler);

            await auditLogger.logOrchestrationAction(
                'workflow:execute',
                mockAuthToken,
                'workflow',
                'workflow-123',
                'success',
                { workflowType: 'test' }
            );

            expect(consoleSpy).toHaveBeenCalled();
            expect(eventHandler).toHaveBeenCalled();
            
            const logEntry = JSON.parse(consoleSpy.mock.calls[0][1]) as AuditLogEntry;
            expect(logEntry.action).toBe('workflow:execute');
            expect(logEntry.agentId).toBe('test-agent');
            expect(logEntry.status).toBe('success');
            expect(logEntry.resourceId).toBe('workflow-123');
        });

        it('should log failed orchestration actions', async () => {
            const eventHandler = vi.fn();
            const securityHandler = vi.fn();
            auditLogger.on('audit:logged', eventHandler);
            auditLogger.on('audit:security', securityHandler);

            const error = new Error('Test error');
            await auditLogger.logOrchestrationAction(
                'workflow:create',
                mockAuthToken,
                'workflow',
                'workflow-123',
                'failure',
                undefined,
                error
            );

            expect(consoleSpy).toHaveBeenCalled();
            expect(eventHandler).toHaveBeenCalled();
            expect(securityHandler).toHaveBeenCalled();
            
            const logEntry = JSON.parse(consoleSpy.mock.calls[0][1]) as AuditLogEntry;
            expect(logEntry.status).toBe('failure');
            expect(logEntry.error).toBe('Test error');
        });

        it('should include metadata in log entries', async () => {
            const metadata = {
                ip: '127.0.0.1',
                userAgent: 'test-agent/1.0'
            };

            await auditLogger.logOrchestrationAction(
                'workflow:execute',
                mockAuthToken,
                'workflow',
                'workflow-123',
                'success',
                undefined,
                undefined,
                metadata
            );

            const logEntry = JSON.parse(consoleSpy.mock.calls[0][1]) as AuditLogEntry;
            expect(logEntry.metadata.ip).toBe('127.0.0.1');
            expect(logEntry.metadata.userAgent).toBe('test-agent/1.0');
            expect(logEntry.metadata.tokenId).toBe('test-token-id');
        });
    });

    describe('Authentication Event Logging', () => {
        it('should log successful authentication events', async () => {
            const eventHandler = vi.fn();
            auditLogger.on('audit:auth', eventHandler);

            await auditLogger.logAuthEvent(
                'login',
                'test-agent',
                'success',
                undefined,
                { ip: '127.0.0.1' }
            );

            expect(consoleSpy).toHaveBeenCalled();
            expect(eventHandler).toHaveBeenCalled();
            
            const logEntry = JSON.parse(consoleSpy.mock.calls[0][1]) as AuditLogEntry;
            expect(logEntry.action).toBe('auth:login');
            expect(logEntry.status).toBe('success');
            expect(logEntry.metadata.ip).toBe('127.0.0.1');
        });

        it('should log failed authentication events', async () => {
            const authHandler = vi.fn();
            const securityHandler = vi.fn();
            auditLogger.on('audit:auth', authHandler);
            auditLogger.on('audit:security', securityHandler);

            await auditLogger.logAuthEvent(
                'login',
                'test-agent',
                'failure',
                'Invalid credentials'
            );

            expect(consoleSpy).toHaveBeenCalled();
            expect(authHandler).toHaveBeenCalled();
            expect(securityHandler).toHaveBeenCalled();
            
            const logEntry = JSON.parse(consoleSpy.mock.calls[0][1]) as AuditLogEntry;
            expect(logEntry.status).toBe('failure');
            expect(logEntry.error).toBe('Invalid credentials');
        });

        it('should log token revocation events', async () => {
            const eventHandler = vi.fn();
            auditLogger.on('audit:auth', eventHandler);

            await auditLogger.logAuthEvent(
                'token_revoked',
                'test-agent',
                'success',
                undefined,
                { tokenId: 'test-token-id' }
            );

            expect(consoleSpy).toHaveBeenCalled();
            expect(eventHandler).toHaveBeenCalled();
            
            const logEntry = JSON.parse(consoleSpy.mock.calls[0][1]) as AuditLogEntry;
            expect(logEntry.action).toBe('auth:token_revoked');
            expect(logEntry.metadata.tokenId).toBe('test-token-id');
        });
    });

    describe('Log Rotation', () => {
        it('should initialize with correct log file', () => {
            const eventHandler = vi.fn();
            auditLogger.on('audit:rotated', eventHandler);

            expect(auditLogger['currentLogFile']).toMatch(/audit-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.log/);
        });

        it('should rotate logs when size limit is reached', async () => {
            const rotationHandler = vi.fn();
            auditLogger.on('audit:rotated', rotationHandler);

            // Write enough entries to trigger rotation
            const largeData = { data: 'x'.repeat(1000) };
            for (let i = 0; i < 5; i++) {
                await auditLogger.logOrchestrationAction(
                    'test',
                    mockAuthToken,
                    'test',
                    'test',
                    'success',
                    largeData
                );
            }

            expect(rotationHandler).toHaveBeenCalled();
            expect(auditLogger['currentFileSize']).toBeLessThan(auditLogger['options'].maxFileSize);
        });
    });

    describe('Log Querying', () => {
        it('should query logs within time range', async () => {
            const startTime = new Date(Date.now() - 3600000); // 1 hour ago
            const endTime = new Date();

            const logs = await auditLogger.queryLogs(startTime, endTime, {
                agentId: 'test-agent',
                action: 'workflow:execute'
            });

            expect(Array.isArray(logs)).toBe(true);
        });
    });
});