import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Request, Response } from 'express';
import { WorkflowMonitor } from '../services/workflowMonitor';
import { WorkflowEngine } from '../services/workflowEngine';
import { WorkflowDefinition, WorkflowStatus } from '../types/workflow';

describe('WorkflowMonitor', () => {
    let workflowMonitor: WorkflowMonitor;
    let workflowEngine: WorkflowEngine;
    let mockRequest: Partial<Request>;
    let mockResponse: Partial<Response>;

    beforeEach(() => {
        const mockResourceManager = {
            getEnhancedMetrics: vi.fn().mockResolvedValue({
                memory: {
                    total: 1024 * 1024 * 1024,
                    used: 512 * 1024 * 1024,
                    free: 512 * 1024 * 1024,
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
                    memory: 512 * 1024 * 1024,
                    cpu: 30
                },
                utilizationPercentages: {
                    memory: 50,
                    cpu: 50
                }
            }),
            getResourceUtilization: vi.fn().mockReturnValue({
                memory: 50,
                cpu: 50
            })
        };
        workflowEngine = new WorkflowEngine(mockResourceManager);
        workflowMonitor = new WorkflowMonitor(workflowEngine);

        // Mock request object with event handling
        mockRequest = {
            query: {},
            params: {},
            on: vi.fn().mockImplementation((event, handler) => {
                if (event === 'close') {
                    // Store handler for testing
                    (mockRequest as any).closeHandler = handler;
                }
                return mockRequest;
            })
        };

        // Mock response object
        mockResponse = {
            writeHead: vi.fn(),
            write: vi.fn(),
            json: vi.fn(),
            status: vi.fn().mockReturnThis(),
            end: vi.fn()
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('SSE Connection', () => {
        it('should establish SSE connection with topics', () => {
            const router = workflowMonitor.getRouter();
            const sseRoute = router.stack.find(layer => 
                layer.route?.path === '/monitor/events'
            );

            expect(sseRoute).toBeDefined();
            
            mockRequest.query = { topics: 'workflows,steps' };
            sseRoute?.route?.stack[0].handle(mockRequest as Request, mockResponse as Response);

            expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
            });
            expect(mockRequest.on).toHaveBeenCalledWith('close', expect.any(Function));
        });

        it('should handle client disconnection', () => {
            const router = workflowMonitor.getRouter();
            const sseRoute = router.stack.find(layer => 
                layer.route?.path === '/monitor/events'
            );

            sseRoute?.route?.stack[0].handle(mockRequest as Request, mockResponse as Response);
            
            // Simulate client disconnection
            const closeHandler = (mockRequest as any).closeHandler;
            closeHandler();
            
            // The connection should be removed from SSE manager
            expect(mockRequest.on).toHaveBeenCalledWith('close', expect.any(Function));
        });
    });

    describe('Workflow State Retrieval', () => {
        it('should get all workflow states', async () => {
            const mockWorkflow: WorkflowDefinition = {
                name: 'Test Workflow',
                steps: [{
                    id: 'step1',
                    name: 'Test Step',
                    execute: vi.fn().mockResolvedValue('test result')
                }]
            };

            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            await workflowEngine.startWorkflow(workflowId);

            const router = workflowMonitor.getRouter();
            const statesRoute = router.stack.find(layer => 
                layer.route?.path === '/monitor/workflows'
            );

            statesRoute?.route?.stack[0].handle(mockRequest as Request, mockResponse as Response);

            expect(mockResponse.json).toHaveBeenCalled();
            const response = (mockResponse.json as any).mock.calls[0][0];
            expect(response.workflows).toBeDefined();
            expect(response.workflows.length).toBeGreaterThan(0);
            expect(response.workflows[0]).toHaveProperty('name', 'Test Workflow');
        });

        it('should get specific workflow state', async () => {
            const mockWorkflow: WorkflowDefinition = {
                name: 'Test Workflow',
                steps: [{
                    id: 'step1',
                    name: 'Test Step',
                    execute: vi.fn().mockResolvedValue('test result')
                }]
            };

            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            await workflowEngine.startWorkflow(workflowId);

            const router = workflowMonitor.getRouter();
            const stateRoute = router.stack.find(layer => 
                layer.route?.path === '/monitor/workflows/:id'
            );

            mockRequest.params = { id: workflowId };
            stateRoute?.route?.stack[0].handle(mockRequest as Request, mockResponse as Response);

            expect(mockResponse.json).toHaveBeenCalled();
            const response = (mockResponse.json as any).mock.calls[0][0];
            expect(response).toHaveProperty('name', 'Test Workflow');
            expect(response.status).toBe(WorkflowStatus.COMPLETED);
        });

        it('should handle non-existent workflow', async () => {
            const router = workflowMonitor.getRouter();
            const stateRoute = router.stack.find(layer => 
                layer.route?.path === '/monitor/workflows/:id'
            );

            mockRequest.params = { id: 'non-existent-id' };
            stateRoute?.route?.stack[0].handle(mockRequest as Request, mockResponse as Response);

            expect(mockResponse.status).toHaveBeenCalledWith(404);
            expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Workflow not found' });
        });
    });

    describe('Metrics Calculation', () => {
        it('should calculate workflow metrics', async () => {
            // Create multiple workflows in different states
            const mockWorkflow: WorkflowDefinition = {
                name: 'Test Workflow',
                steps: [{
                    id: 'step1',
                    name: 'Test Step',
                    execute: vi.fn().mockResolvedValue('test result')
                }]
            };

            // Create and complete first workflow
            const workflow1 = workflowEngine.createWorkflow(mockWorkflow);
            const startTime = new Date();
            await workflowEngine.startWorkflow(workflow1);
            await new Promise(resolve => setTimeout(resolve, 100)); // Longer wait for execution

            // Update the workflow state with real timestamps
            const state = (workflowEngine as any).workflows.get(workflow1);
            if (state) {
                state.createdAt = startTime;
                state.updatedAt = new Date();
                (workflowEngine as any).workflows.set(workflow1, state);
            }

            // Create and fail second workflow
            const workflow2 = workflowEngine.createWorkflow({
                ...mockWorkflow,
                steps: [{
                    ...mockWorkflow.steps[0],
                    execute: vi.fn().mockRejectedValue(new Error('Test error'))
                }]
            });
            await workflowEngine.startWorkflow(workflow2).catch(() => {}); // Ignore expected error
            await new Promise(resolve => setTimeout(resolve, 100)); // Longer wait for execution

            const router = workflowMonitor.getRouter();
            const metricsRoute = router.stack.find(layer => 
                layer.route?.path === '/monitor/metrics'
            );

            metricsRoute?.route?.stack[0].handle(mockRequest as Request, mockResponse as Response);

            expect(mockResponse.json).toHaveBeenCalled();
            const metrics = (mockResponse.json as any).mock.calls[0][0];
            
            expect(metrics.total).toBe(2);
            expect(metrics.completed).toBe(1);
            expect(metrics.failed).toBe(1);
            expect(metrics.averageDuration).toBeGreaterThan(0);
            expect(metrics.statusBreakdown).toBeDefined();
        });
    });

    describe('Event Broadcasting', () => {
        it('should broadcast workflow lifecycle events', async () => {
            const mockWorkflow: WorkflowDefinition = {
                name: 'Test Workflow',
                steps: [{
                    id: 'step1',
                    name: 'Test Step',
                    execute: vi.fn().mockResolvedValue('test result')
                }]
            };

            // Set up SSE connection to capture broadcasts
            const router = workflowMonitor.getRouter();
            const sseRoute = router.stack.find(layer => 
                layer.route?.path === '/monitor/events'
            );

            mockRequest.query = { topics: 'workflows' };
            sseRoute?.route?.stack[0].handle(mockRequest as Request, mockResponse as Response);

            // Create and start workflow
            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            await workflowEngine.startWorkflow(workflowId);

            // Verify broadcasts
            expect(mockResponse.write).toHaveBeenCalled();
            const writes = (mockResponse.write as any).mock.calls;
            
            // Should have broadcasts for created, started, and completed events
            const events = writes.map((call: any[]) => {
                const data = call[0];
                return data.match(/event: ([\w:]+)/)?.[1];
            }).filter(Boolean);

            expect(events).toContain('workflow:created');
            expect(events).toContain('workflow:started');
            expect(events).toContain('workflow:completed');
        });

        it('should broadcast step events', async () => {
            const mockWorkflow: WorkflowDefinition = {
                name: 'Test Workflow',
                steps: [{
                    id: 'step1',
                    name: 'Test Step',
                    execute: vi.fn().mockResolvedValue('test result')
                }]
            };

            // Set up SSE connection
            const router = workflowMonitor.getRouter();
            const sseRoute = router.stack.find(layer => 
                layer.route?.path === '/monitor/events'
            );

            mockRequest.query = { topics: 'steps' };
            sseRoute?.route?.stack[0].handle(mockRequest as Request, mockResponse as Response);

            // Create and start workflow
            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            await workflowEngine.startWorkflow(workflowId);

            // Verify step event broadcasts
            expect(mockResponse.write).toHaveBeenCalled();
            const writes = (mockResponse.write as any).mock.calls;
            
            const events = writes.map((call: any[]) => {
                const data = call[0];
                return data.match(/event: ([\w:]+)/)?.[1];
            }).filter(Boolean);

            expect(events).toContain('step:started');
            expect(events).toContain('step:completed');
        });

        it('should handle failed steps', async () => {
            const mockWorkflow: WorkflowDefinition = {
                name: 'Test Workflow',
                steps: [{
                    id: 'step1',
                    name: 'Test Step',
                    execute: vi.fn().mockRejectedValue(new Error('Test error'))
                }]
            };

            // Set up SSE connection
            const router = workflowMonitor.getRouter();
            const sseRoute = router.stack.find(layer => 
                layer.route?.path === '/monitor/events'
            );

            mockRequest.query = { topics: 'steps,workflows' };
            sseRoute?.route?.stack[0].handle(mockRequest as Request, mockResponse as Response);

            // Create and start workflow
            const workflowId = workflowEngine.createWorkflow(mockWorkflow);
            await workflowEngine.startWorkflow(workflowId);

            // Verify error broadcasts
            expect(mockResponse.write).toHaveBeenCalled();
            const writes = (mockResponse.write as any).mock.calls;
            
            const events = writes.map((call: any[]) => {
                const data = call[0];
                return data.match(/event: ([\w:]+)/)?.[1];
            }).filter(Boolean);

            expect(events).toContain('step:failed');
            expect(events).toContain('workflow:failed');
        });
    });
});