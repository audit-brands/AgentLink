import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Request, Response } from 'express';
import { SSEManager } from '../services/sseManager';

describe('SSEManager', () => {
    let sseManager: SSEManager;
    let mockRequest: Partial<Request>;
    let mockResponse: Partial<Response>;
    
    beforeEach(() => {
        sseManager = new SSEManager();
        
        // Mock request
        mockRequest = {
            on: vi.fn(),
        };

        // Mock response
        mockResponse = {
            writeHead: vi.fn(),
            write: vi.fn(),
            end: vi.fn(),
        };
    });

    afterEach(() => {
        sseManager.close();
        vi.clearAllMocks();
    });

    describe('Connection Management', () => {
        it('should establish new SSE connection with correct headers', () => {
            const clientId = sseManager.connect(mockRequest as Request, mockResponse as Response);
            
            expect(clientId).toBeDefined();
            expect(typeof clientId).toBe('string');
            expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
            });
        });

        it('should handle client disconnection', () => {
            const clientId = sseManager.connect(mockRequest as Request, mockResponse as Response);
            const closeHandler = (mockRequest.on as any).mock.calls[0][1];
            
            closeHandler();
            expect(sseManager.getClients().has(clientId)).toBe(false);
        });

        it('should track connected clients', () => {
            const clientId = sseManager.connect(mockRequest as Request, mockResponse as Response);
            const clients = sseManager.getClients();
            
            expect(clients.size).toBe(1);
            expect(clients.get(clientId)).toBeDefined();
        });
    });

    describe('Event Broadcasting', () => {
        it('should broadcast events to all clients without topics', () => {
            const clientId1 = sseManager.connect(mockRequest as Request, mockResponse as Response);
            const clientId2 = sseManager.connect(mockRequest as Request, { ...mockResponse } as Response);
            
            const testEvent = 'test';
            const testData = { message: 'Hello' };
            
            // Clear the mock calls from the initial retry messages
            vi.clearAllMocks();
            
            sseManager.broadcast('general', testEvent, testData);
            
            expect(mockResponse.write).toHaveBeenCalledTimes(2);
            expect(mockResponse.write).toHaveBeenCalledWith(
                `event: ${testEvent}\ndata: ${JSON.stringify(testData)}\n\n`
            );
        });

        it('should only broadcast to clients subscribed to specific topics', () => {
            const clientId1 = sseManager.connect(mockRequest as Request, mockResponse as Response, ['topic1']);
            const clientId2 = sseManager.connect(mockRequest as Request, { ...mockResponse } as Response, ['topic2']);
            
            // Clear the mock calls from the initial retry messages
            vi.clearAllMocks();
            
            sseManager.broadcast('topic1', 'test', 'data');
            
            expect(mockResponse.write).toHaveBeenCalledTimes(1);
        });
    });

    describe('Topic Management', () => {
        it('should update client topic subscriptions', () => {
            const clientId = sseManager.connect(mockRequest as Request, mockResponse as Response);
            const newTopics = ['topic1', 'topic2'];
            
            sseManager.updateTopics(clientId, newTopics);
            
            const client = sseManager.getClients().get(clientId);
            expect(client?.topics).toEqual(newTopics);
        });

        it('should handle non-existent client for topic updates', () => {
            sseManager.updateTopics('non-existent', ['topic1']);
            expect(sseManager.getClients().size).toBe(0);
        });
    });

    describe('Direct Client Communication', () => {
        it('should send events to specific clients', () => {
            const clientId = sseManager.connect(mockRequest as Request, mockResponse as Response);
            
            sseManager.sendEvent(clientId, 'test', 'message');
            
            expect(mockResponse.write).toHaveBeenCalledWith(
                'event: test\ndata: message\n\n'
            );
        });

        it('should handle sending to non-existent clients', () => {
            sseManager.sendEvent('non-existent', 'test', 'data');
            expect(mockResponse.write).not.toHaveBeenCalled();
        });
    });

    describe('Connection Settings', () => {
        it('should set retry interval for all clients', () => {
            const clientId = sseManager.connect(mockRequest as Request, mockResponse as Response);
            const newInterval = 5000;
            
            sseManager.setRetryInterval(newInterval);
            
            expect(mockResponse.write).toHaveBeenCalledWith(`retry: ${newInterval}\n\n`);
        });
    });

    describe('Cleanup', () => {
        it('should close all connections', () => {
            sseManager.connect(mockRequest as Request, mockResponse as Response);
            sseManager.connect(mockRequest as Request, { ...mockResponse } as Response);
            
            sseManager.close();
            
            expect(mockResponse.end).toHaveBeenCalledTimes(2);
            expect(sseManager.getClients().size).toBe(0);
        });
    });
});