import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTaskQueue } from '../services/taskQueue';
import { AgentTask, TaskStatus } from '../types/orchestration';

describe('InMemoryTaskQueue', () => {
    let taskQueue: InMemoryTaskQueue;
    let mockTask: AgentTask;

    beforeEach(() => {
        taskQueue = new InMemoryTaskQueue(2); // Small size for testing
        mockTask = {
            id: '123',
            method: 'test',
            params: {},
            sourceAgent: 'test-agent',
            targetAgent: 'target-agent',
            status: TaskStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date()
        };
    });

    it('should enqueue a task successfully', async () => {
        await taskQueue.enqueue(mockTask);
        expect(await taskQueue.size()).toBe(1);
    });

    it('should enforce queue size limit', async () => {
        await taskQueue.enqueue(mockTask);
        await taskQueue.enqueue({ ...mockTask, id: '456' });
        
        await expect(taskQueue.enqueue({ ...mockTask, id: '789' }))
            .rejects.toThrow('Task queue is full');
    });

    it('should dequeue tasks in FIFO order', async () => {
        const task1 = { ...mockTask, id: '1' };
        const task2 = { ...mockTask, id: '2' };
        
        await taskQueue.enqueue(task1);
        await taskQueue.enqueue(task2);
        
        const dequeued1 = await taskQueue.dequeue();
        const dequeued2 = await taskQueue.dequeue();
        
        expect(dequeued1?.id).toBe('1');
        expect(dequeued2?.id).toBe('2');
    });

    it('should update task status on dequeue', async () => {
        await taskQueue.enqueue(mockTask);
        const dequeued = await taskQueue.dequeue();
        expect(dequeued?.status).toBe(TaskStatus.IN_PROGRESS);
    });

    it('should return null when dequeueing from empty queue', async () => {
        const result = await taskQueue.dequeue();
        expect(result).toBeNull();
    });

    it('should peek at next task without removing it', async () => {
        await taskQueue.enqueue(mockTask);
        const size1 = await taskQueue.size();
        const peeked = await taskQueue.peek();
        const size2 = await taskQueue.size();
        
        expect(peeked?.id).toBe(mockTask.id);
        expect(size1).toBe(size2);
    });

    it('should maintain correct size after operations', async () => {
        expect(await taskQueue.size()).toBe(0);
        
        await taskQueue.enqueue(mockTask);
        expect(await taskQueue.size()).toBe(1);
        
        await taskQueue.dequeue();
        expect(await taskQueue.size()).toBe(0);
    });
});