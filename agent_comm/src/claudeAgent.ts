import express from 'express';
import { Request, Response } from 'express';
import { exec } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { agentRegistry } from './registry';
import { AgentStatus, RegisteredAgent, AgentCapability } from './types/orchestration';

const execAsync = promisify(exec);

interface JsonRpcRequest {
    jsonrpc: "2.0";
    method: string;
    params?: any;
    id: number | string | null;
}

interface JsonRpcResponse {
    jsonrpc: "2.0";
    result?: any;
    error?: { code: number; message: string; data?: any };
    id: number | string | null;
}

interface JsonRpcError extends Error {
    code: number;
    data?: any;
}

class ClaudeAgent {
    private app = express();
    private readonly PORT = 5000;
    private status: AgentStatus = AgentStatus.ONLINE;
    private capabilities: AgentCapability[] = [
        {
            name: "code-refactor",
            methods: ["RequestRefactor"],
            version: "1.0.0"
        }
    ];

    constructor() {
        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware() {
        this.app.use(express.json());
        this.app.use((req, res, next) => {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
            next();
        });
    }

    private setupRoutes() {
        this.app.post('/', this.handleJsonRpcRequest.bind(this));
        this.app.get('/.well-known/agent.json', this.handleAgentInfo.bind(this));
    }

    private async runClaudeCli(prompt: string): Promise<string | JsonRpcResponse> {
        try {
            const cliPath = path.resolve(__dirname, '../claude-cli');
            const command = `${cliPath} "${prompt}"`;
            console.log(`[EXEC] Running Claude CLI command: ${command}`);

            const { stdout, stderr } = await execAsync(command);
            
            if (stderr) {
                console.warn(`[EXEC] Claude CLI stderr: ${stderr}`);
            }

            try {
                const jsonOutput = JSON.parse(stdout.trim());
                if (jsonOutput?.jsonrpc === '2.0' && jsonOutput.error) {
                    return jsonOutput;
                }
                return stdout.trim();
            } catch {
                return stdout.trim();
            }
        } catch (error) {
            console.error('[ERROR] Claude CLI execution failed:', error);
            return {
                jsonrpc: "2.0",
                error: {
                    code: -32000,
                    message: "CLI execution error",
                    data: error instanceof Error ? error.message : String(error)
                },
                id: null
            };
        }
    }

    private async handleJsonRpcRequest(req: Request, res: Response) {
        const requestData = req.body as JsonRpcRequest;
        console.log(`[DEBUG] Received request: ${JSON.stringify(requestData)}`);

        try {
            if (this.status === AgentStatus.OFFLINE) {
                throw { code: -32001, message: "Agent is offline" };
            }

            if (requestData.jsonrpc !== "2.0") {
                throw { code: -32600, message: "Invalid Request", data: "jsonrpc must be \"2.0\"" };
            }

            if (typeof requestData.method !== "string") {
                throw { code: -32600, message: "Invalid Request", data: "method must be a string" };
            }

            if (requestData.method === "RequestRefactor") {
                this.status = AgentStatus.BUSY;
                const params = requestData.params || {};
                
                if (!params.instruction) {
                    throw { code: -32602, message: "Invalid params", data: "instruction is required" };
                }

                const output = await this.runClaudeCli(params.instruction);
                
                this.status = AgentStatus.ONLINE;
                
                if (typeof output === 'object' && 'jsonrpc' in output) {
                    res.json(output);
                } else {
                    res.json({
                        jsonrpc: "2.0",
                        result: output,
                        id: requestData.id
                    });
                }
            } else {
                throw { code: -32601, message: "Method not found" };
            }
        } catch (error) {
            const jsonRpcError = error as JsonRpcError;
            res.json({
                jsonrpc: "2.0",
                error: {
                    code: jsonRpcError.code || -32603,
                    message: jsonRpcError.message || "Internal error",
                    data: jsonRpcError.data
                },
                id: requestData.id || null
            });
        }
    }

    private handleAgentInfo(req: Request, res: Response) {
        const agentInfo: RegisteredAgent = {
            id: "claude-agent",
            name: "Claude CLI Agent",
            endpoint: `http://localhost:${this.PORT}`,
            capabilities: this.capabilities,
            status: this.status,
            lastSeen: new Date()
        };

        res.setHeader('Content-Type', 'application/json');
        res.json(agentInfo);
    }

    public start() {
        this.app.listen(this.PORT, () => {
            console.log(`Claude agent running on http://localhost:${this.PORT}`);
            
            const agentCard = {
                id: "claude-agent",
                name: "Claude CLI Agent",
                capabilities: this.capabilities,
                endpoint: `http://localhost:${this.PORT}`
            };
            
            agentRegistry.registerAgent(agentCard);

            setInterval(() => {
                agentRegistry.registerAgent(agentCard);
            }, 30000);

            const shutdown = () => {
                console.log('Claude agent shutting down...');
                this.status = AgentStatus.OFFLINE;
                agentRegistry.deregisterAgent(agentCard.id);
                process.exit(0);
            };

            // Handle both SIGINT (Ctrl+C) and SIGTERM
            process.on('SIGINT', shutdown);
            process.on('SIGTERM', shutdown);
        });
    }
}

// Start the agent
const claudeAgent = new ClaudeAgent();
claudeAgent.start();