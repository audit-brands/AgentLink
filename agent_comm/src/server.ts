import express from 'express';
import { BasicOrchestrator } from './services/orchestrator';
import { InMemoryTaskQueue } from './services/taskQueue';
import { InMemoryAgentRegistry } from './services/agentRegistry';
import { SimpleTaskRouter } from './services/taskRouter';

const app = express();
app.use(express.json());

// Initialize orchestration services
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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Orchestration service running on port ${PORT}`);
});