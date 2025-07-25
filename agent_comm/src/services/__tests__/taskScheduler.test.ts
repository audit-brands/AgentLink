import { TaskScheduler, Task, TaskSchedulerConfig } from '../taskScheduler';
import { EnhancedResourceManager, ResourceLimits } from '../enhancedResourceManager';
import { EventEmitter } from 'events';

describe('TaskScheduler', () => {
    let taskScheduler: TaskScheduler;
    let resourceManager: EnhancedResourceManager;
    let eventEmitter: EventEmitter;
    let config: TaskSchedulerConfig;

    beforeEach(() => {
        eventEmitter = new EventEmitter();
        const limits: ResourceLimits = {
            memory: {
                max: 90,
                warning: 80
            },
            cpu: {
                maxUsage: 90,
                warning: 80
            }
        };
        resourceManager = new EnhancedResourceManager(limits);

        // Mock resource manager methods
        jest.spyOn(resourceManager, 'canHandleTask').mockResolvedValue(true);
        jest.spyOn(resourceManager, 'reserveResources').mockResolvedValue(true);
        jest.spyOn(resourceManager, 'releaseResources').mockImplementation(() => {});

        config = {
            maxConcurrentTasks: 2,
            taskTimeoutMs: 1000,
            maxRetries: 3
        };

        taskScheduler = new TaskScheduler(config, resourceManager, eventEmitter);
    });

    afterEach(() => {
        resourceManager.stop();
        jest.clearAllMocks();
    });

    describe('canExecuteTask', () => {
        it('should return false when max concurrent tasks reached', async () => {
            const task1: Task = { 
                id: '1', 
                execute: jest.fn(),
                requiredResources: { memory: 100, cpu: 10 }
            };
            const task2: Task = { 
                id: '2', 
                execute: jest.fn(),
                requiredResources: { memory: 100, cpu: 10 }
            };
            const task3: Task = { 
                id: '3', 
                execute: jest.fn(),
                requiredResources: { memory: 100, cpu: 10 }
            };

            // Add and execute first two tasks
            taskScheduler.addTask(task1);
            taskScheduler.addTask(task2);
            taskScheduler.addTask(task3);
            
            // Start long-running tasks
            const task1Promise = taskScheduler.executeTask('1');
            const task2Promise = taskScheduler.executeTask('2');
            
            // Try to execute third task while others are running
            await expect(taskScheduler.executeTask('3')).rejects.toThrow('Maximum concurrent tasks limit reached');
            
            // Clean up
            await task1Promise;
            await task2Promise;
        });

        it('should return false for duplicate task IDs', async () => {
            const task: Task = { 
                id: '1', 
                execute: jest.fn(),
                requiredResources: { memory: 100, cpu: 10 }
            };
            taskScheduler.addTask(task);

            const result = await taskScheduler.canExecuteTask(task);
            expect(result).toBe(false);
        });

        it('should check resource availability', async () => {
            const task: Task = { 
                id: '1', 
                execute: jest.fn(),
                requiredResources: { memory: 100, cpu: 10 }
            };
            
            const canHandleSpy = jest.spyOn(resourceManager, 'canHandleTask');
            await taskScheduler.canExecuteTask(task);
            
            expect(canHandleSpy).toHaveBeenCalledWith(task.requiredResources);
        });
    });

    describe('task execution with resource management', () => {
        it('should successfully execute task when resources are available', async () => {
            const task: Task = {
                id: '1',
                execute: jest.fn().mockResolvedValue('success'),
                onSuccess: jest.fn(),
                requiredResources: { memory: 100, cpu: 10 }
            };

            const reserveSpy = jest.spyOn(resourceManager, 'reserveResources');
            const releaseSpy = jest.spyOn(resourceManager, 'releaseResources');
            
            taskScheduler.addTask(task);
            await taskScheduler.executeTask('1');

            expect(task.execute).toHaveBeenCalled();
            expect(task.onSuccess).toHaveBeenCalledWith('success');
            expect(reserveSpy).toHaveBeenCalledWith('1', task.requiredResources);
            expect(releaseSpy).toHaveBeenCalledWith('1');
        });

        it('should handle task execution failure', async () => {
            const error = new Error('Task failed');
            const task: Task = {
                id: '1',
                execute: jest.fn().mockRejectedValue(error),
                onError: jest.fn(),
                requiredResources: { memory: 100, cpu: 10 }
            };

            const reserveSpy = jest.spyOn(resourceManager, 'reserveResources');
            const releaseSpy = jest.spyOn(resourceManager, 'releaseResources');
            
            taskScheduler.addTask(task);
            await expect(taskScheduler.executeTask('1')).rejects.toThrow('Task failed');

            expect(task.execute).toHaveBeenCalled();
            expect(task.onError).toHaveBeenCalledWith(error);
            expect(reserveSpy).toHaveBeenCalledWith('1', task.requiredResources);
            expect(releaseSpy).toHaveBeenCalledWith('1');
        });

        it('should handle resource reservation failure', async () => {
            const task: Task = {
                id: '1',
                execute: jest.fn(),
                onError: jest.fn(),
                requiredResources: { memory: 100, cpu: 10 }
            };

            jest.spyOn(resourceManager, 'reserveResources').mockResolvedValue(false);
            
            taskScheduler.addTask(task);
            await expect(taskScheduler.executeTask('1')).rejects.toThrow('Failed to reserve resources');

            expect(task.execute).not.toHaveBeenCalled();
        });
    });

    describe('cleanup and resource management', () => {
        it('should properly clean up resources', () => {
            const task: Task = { 
                id: '1', 
                execute: jest.fn(),
                requiredResources: { memory: 100, cpu: 10 }
            };
            taskScheduler.addTask(task);
            taskScheduler.cleanup();

            expect(taskScheduler.getActiveTaskCount()).toBe(0);
            expect(taskScheduler.isTaskActive('1')).toBe(false);
        });

        it('should handle task cancellation and release resources', async () => {
            const task: Task = { 
                id: '1', 
                execute: jest.fn(),
                requiredResources: { memory: 100, cpu: 10 }
            };
            taskScheduler.addTask(task);
            
            // Simulate active task
            await taskScheduler.executeTask('1');
            const releaseSpy = jest.spyOn(resourceManager, 'releaseResources');
            
            await taskScheduler.cancelTask('1');

            expect(taskScheduler.isTaskActive('1')).toBe(false);
            expect(releaseSpy).toHaveBeenCalledWith('1');
        });
    });
});