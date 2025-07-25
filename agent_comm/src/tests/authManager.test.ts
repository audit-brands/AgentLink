import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AuthManager, AuthToken } from '../services/authManager';
import { Request, Response, NextFunction } from 'express';

describe('AuthManager', () => {
    let authManager: AuthManager;
    let mockRequest: Partial<Request>;
    let mockResponse: Partial<Response>;
    let mockNext: NextFunction;

    beforeEach(() => {
        authManager = new AuthManager('test-secret');
        mockRequest = {
            headers: {}
        };
        mockResponse = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        };
        mockNext = vi.fn();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Agent Registration and Authentication', () => {
        it('should register a new agent with credentials', () => {
            const credentials = authManager.registerAgent('test-agent');
            
            expect(credentials.agentId).toBe('test-agent');
            expect(credentials.apiKey).toBeDefined();
            expect(credentials.roles).toEqual(['agent']);
        });

        it('should register an agent with custom roles', () => {
            const credentials = authManager.registerAgent('admin-agent', ['admin']);
            
            expect(credentials.roles).toEqual(['admin']);
        });

        it('should authenticate an agent with valid credentials', async () => {
            const credentials = authManager.registerAgent('test-agent');
            const token = await authManager.authenticate(credentials.agentId, credentials.apiKey);
            
            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
        });

        it('should reject authentication with invalid credentials', async () => {
            await expect(
                authManager.authenticate('invalid-agent', 'invalid-key')
            ).rejects.toThrow('Invalid credentials');
        });
    });

    describe('Token Validation', () => {
        it('should validate a valid token', async () => {
            const credentials = authManager.registerAgent('test-agent');
            const token = await authManager.authenticate(credentials.agentId, credentials.apiKey);
            const decoded = authManager.validateToken(token);
            
            expect(decoded.agentId).toBe('test-agent');
            expect(decoded.roles).toEqual(['agent']);
            expect(Array.isArray(decoded.permissions)).toBe(true);
        });

        it('should reject an invalid token', () => {
            expect(() => {
                authManager.validateToken('invalid-token');
            }).toThrow('Invalid token');
        });

        it('should reject a revoked token', async () => {
            const credentials = authManager.registerAgent('test-agent');
            const token = await authManager.authenticate(credentials.agentId, credentials.apiKey);
            
            authManager.revokeToken(token);
            
            expect(() => {
                authManager.validateToken(token);
            }).toThrow('Token has been revoked');
        });
    });

    describe('Authentication Middleware', () => {
        it('should pass authentication with valid token', async () => {
            const credentials = authManager.registerAgent('test-agent');
            const token = await authManager.authenticate(credentials.agentId, credentials.apiKey);
            
            mockRequest.headers = {
                authorization: `Bearer ${token}`
            };

            authManager.authMiddleware(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            expect(mockNext).toHaveBeenCalled();
            expect(mockResponse.status).not.toHaveBeenCalled();
        });

        it('should reject requests without token', () => {
            authManager.authMiddleware(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            expect(mockResponse.status).toHaveBeenCalledWith(401);
            expect(mockResponse.json).toHaveBeenCalledWith({ error: 'No token provided' });
        });

        it('should reject requests with invalid token', () => {
            mockRequest.headers = {
                authorization: 'Bearer invalid-token'
            };

            authManager.authMiddleware(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            expect(mockResponse.status).toHaveBeenCalledWith(401);
            expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Invalid token' });
        });
    });

    describe('Permission Checking', () => {
        it('should allow access with required permission', async () => {
            const credentials = authManager.registerAgent('test-agent', ['orchestrator']);
            const token = await authManager.authenticate(credentials.agentId, credentials.apiKey);
            
            mockRequest.headers = {
                authorization: `Bearer ${token}`
            };

            // First run auth middleware to set req.auth
            authManager.authMiddleware(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            // Then check permission
            const permissionCheck = authManager.checkPermission('workflow:execute');
            permissionCheck(mockRequest as Request, mockResponse as Response, mockNext);

            expect(mockNext).toHaveBeenCalledTimes(2);
        });

        it('should deny access without required permission', async () => {
            const credentials = authManager.registerAgent('test-agent', ['agent']);
            const token = await authManager.authenticate(credentials.agentId, credentials.apiKey);
            
            mockRequest.headers = {
                authorization: `Bearer ${token}`
            };

            // First run auth middleware
            authManager.authMiddleware(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            // Then check permission
            const permissionCheck = authManager.checkPermission('agent:manage');
            permissionCheck(mockRequest as Request, mockResponse as Response, mockNext);

            expect(mockResponse.status).toHaveBeenCalledWith(403);
            expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Permission denied' });
        });
    });

    describe('Role Checking', () => {
        it('should allow access with required role', async () => {
            const credentials = authManager.registerAgent('test-agent', ['admin']);
            const token = await authManager.authenticate(credentials.agentId, credentials.apiKey);
            
            mockRequest.headers = {
                authorization: `Bearer ${token}`
            };

            // First run auth middleware
            authManager.authMiddleware(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            // Then check role
            const roleCheck = authManager.checkRole('admin');
            roleCheck(mockRequest as Request, mockResponse as Response, mockNext);

            expect(mockNext).toHaveBeenCalledTimes(2);
        });

        it('should deny access without required role', async () => {
            const credentials = authManager.registerAgent('test-agent', ['agent']);
            const token = await authManager.authenticate(credentials.agentId, credentials.apiKey);
            
            mockRequest.headers = {
                authorization: `Bearer ${token}`
            };

            // First run auth middleware
            authManager.authMiddleware(
                mockRequest as Request,
                mockResponse as Response,
                mockNext
            );

            // Then check role
            const roleCheck = authManager.checkRole('admin');
            roleCheck(mockRequest as Request, mockResponse as Response, mockNext);

            expect(mockResponse.status).toHaveBeenCalledWith(403);
            expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Role not authorized' });
        });
    });
});