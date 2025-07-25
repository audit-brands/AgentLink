import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { BasicOrchestrator } from '../services/orchestrator';
import { InMemoryTaskQueue } from '../services/taskQueue';
import { InMemoryAgentRegistry } from '../services/agentRegistry';
import { SimpleTaskRouter } from '../services/taskRouter';
import { AgentStatus } from '../types/orchestration';

describe('Server Integration Tests', () => {
    const app = express();
    app.use(express.json());

    const taskQueue = new InMemoryTaskQueue(1000);
    const agentRegistry = new InMemoryAgentRegistry();
    const taskRouter = new SimpleTaskRouter(agentRegistry);
    const orchestrator = new BasicOrchestrator(
        taskQueue,
        agentRegistry,
        taskRouter,
        {
            retryAttempts: 3,
            retryDelay: 1000
        }
    );

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({ status: 'ok' });
    });

    // Agent registration endpoint
    app.post('/agents/register', async (req, res) => {
        try {
            await agentRegistry.register(req.body);
            res.json({ success: true });
        } catch (error) {
            res.status(400).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    // Task submission endpoint
    app.post('/tasks', async (req, res) => {
        try {
            const taskId = await orchestrator.submitTask(req.body);
            res.json({ taskId });
        } catch (error) {
            res.status(400).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    // Task status endpoint
    app.get('/tasks/:taskId', async (req, res) => {
        try {
            const status = await orchestrator.getTaskStatus(req.params.taskId);
            res.json({ status });
        } catch (error) {
            res.status(404).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    // Metrics endpoint
    app.get('/metrics', async (req, res) => {
        try {
            const metrics = await orchestrator.getMetrics();
            res.json(metrics);
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

    let server: any;
    beforeAll(() => {
        server = app.listen(3001);
    });

    afterAll(() => {
        server.close();
    });

    it('should respond to health check', async () => {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ status: 'ok' });
    });

    it('should register an agent', async () => {
        const agent = {
            id: 'test-agent',
            name: 'Test Agent',
            endpoint: 'http://localhost:3000',
            capabilities: [{
                name: 'test-capability',
                methods: ['test-method'],
                version: '1.0.0'
            }],
            status: AgentStatus.ONLINE,
            lastSeen: new Date()
        };

        const response = await request(app)
            .post('/agents/register')
            .send(agent);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
    });

    it('should submit a task', async () => {
        const task = {
            method: 'test-method',
            params: {},
            sourceAgent: 'source-agent',
            targetAgent: 'test-agent'
        };

        const response = await request(app)
            .post('/tasks')
            .send(task);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('taskId');
    });

    it('should get task status', async () => {
        const task = {
            method: 'test-method',
            params: {},
            sourceAgent: 'source-agent',
            targetAgent: 'test-agent'
        };

        const submitResponse = await request(app)
            .post('/tasks')
            .send(task);

        const taskId = submitResponse.body.taskId;
        const statusResponse = await request(app)
            .get(`/tasks/${taskId}`);

        expect(statusResponse.status).toBe(200);
        expect(statusResponse.body).toHaveProperty('status');
    });

    it('should return 404 for non-existent task', async () => {
        const response = await request(app)
            .get('/tasks/non-existent');

        expect(response.status).toBe(404);
    });

    it('should get metrics', async () => {
        const response = await request(app)
            .get('/metrics');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            taskCount: expect.any(Number),
            completedTasks: expect.any(Number),
            failedTasks: expect.any(Number),
            averageProcessingTime: expect.any(Number),
            activeAgents: expect.any(Number)
        });
    });
});