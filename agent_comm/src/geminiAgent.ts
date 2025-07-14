import express from 'express';
import { Request, Response } from 'express';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { agentRegistry } from './registry';

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

const app = express();
const PORT = 5001;

app.use(express.json());

function runGeminiCli(prompt: string): Promise<string | JsonRpcResponse> {
    return new Promise((resolve) => {
        const command = `${path.resolve(__dirname, '../gemini-cli')} "${prompt}"`;
        console.log(`[EXEC] Running Gemini CLI command: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (stderr) {
                console.warn(`[EXEC] Gemini CLI stderr: ${stderr}`);
            }

            if (error) {
                console.error(`[EXEC] Gemini CLI execution error: ${error.message}`);
                resolve({
                    jsonrpc: "2.0",
                    error: { code: -32000, message: "CLI execution error", data: stderr || error.message },
                    id: null
                });
                return;
            }

            try {
                const jsonOutput = JSON.parse(stdout.trim());
                if (jsonOutput && typeof jsonOutput === 'object' && jsonOutput.jsonrpc === '2.0' && jsonOutput.error) {
                    resolve(jsonOutput); // It's a JSON-RPC error from the CLI
                } else {
                    resolve(stdout.trim());
                }
            } catch (e) {
                resolve(stdout.trim()); // Not a JSON response, return as is
            }
        });
    });
}

// JSON-RPC endpoint
app.post('/', async (req: Request, res: Response) => {
    const requestData = req.body;
    console.log(`[DEBUG] Received request: ${JSON.stringify(requestData)}`);

    let responseData: any = {};

    if (requestData.jsonrpc !== "2.0") {
        responseData = {
            jsonrpc: "2.0",
            error: { code: -32600, message: "Invalid Request", data: "jsonrpc must be \"2.0\"" },
            id: requestData.id || null
        };
    } else if (typeof requestData.method !== "string") {
        responseData = {
            jsonrpc: "2.0",
            error: { code: -32600, message: "Invalid Request", data: "method must be a string" },
            id: requestData.id || null
        };
    } else if (requestData.method === "RequestRefactor") {
        const params = requestData.params || {};
        const messageId = requestData.id;

        console.log(" New refactor task received for Gemini!");
        console.log(`[DEBUG] Code path: ${params.code_path}, Instruction: ${params.instruction}`);
        
        const output = await runGeminiCli(params.instruction);
        if (typeof output === 'object' && output.jsonrpc === "2.0" && output.error) {
            responseData = output;
        } else {
            responseData = {
                jsonrpc: "2.0",
                result: output,
                id: messageId
            };
        }
    } else {
        responseData = {
            jsonrpc: "2.0",
            error: { code: -32601, message: "Method not found" },
            id: requestData.id || null
        };
    }

    res.json(responseData);
    console.log(`[DEBUG] Sent response: ${JSON.stringify(responseData)}`);
});

// Serve .well-known/agent.json
app.get('/.well-known/agent.json', (req: Request, res: Response) => {
    const geminiAgentCard = agentRegistry.getAgent('gemini-agent');
    if (geminiAgentCard) {
        res.setHeader('Content-Type', 'application/json');
        res.json(geminiAgentCard);
    } else {
        res.status(404).send("Agent card not found");
    }
});

app.listen(PORT, () => {
    console.log(`Gemini agent (Node.js HTTP Server) is running on http://localhost:${PORT}`);
});