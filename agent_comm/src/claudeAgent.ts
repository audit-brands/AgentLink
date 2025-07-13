import express from 'express';
import { Request, Response } from 'express';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = 5000;

app.use(express.json());

function runClaudeCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const command = `${path.resolve(__dirname, '../claude-cli')} "${prompt}"`;
        console.log(`[EXEC] Running Claude CLI command: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`[EXEC] Claude CLI execution error: ${error.message}`);
                reject(new Error(`Claude CLI execution failed: ${stderr || error.message}`));
                return;
            }
            if (stderr) {
                console.warn(`[EXEC] Claude CLI stderr: ${stderr}`);
            }
            console.log(`[EXEC] Claude CLI stdout: ${stdout}`);
            resolve(stdout.trim()); // Trim whitespace from output
        });
    });
}

// JSON-RPC endpoint
app.post('/', async (req: Request, res: Response) => {
    const requestData = req.body;
    console.log(`[DEBUG] Received request: ${JSON.stringify(requestData)}`);

    let responseData: any = {};

    if (requestData.jsonrpc === "2.0" && requestData.method === "RequestRefactor") {
        const params = requestData.params || {};
        const messageId = requestData.id;

        console.log(" New refactor task received for Claude!");
        console.log(`[DEBUG] Code path: ${params.code_path}, Instruction: ${params.instruction}`);
        
        const output = await runClaudeCli(params.instruction);
        console.log(`[DEBUG] Output before responseData assignment: ${output}`);

        responseData = {
            jsonrpc: "2.0",
            result: output,
            id: messageId
        };
    } else {
        responseData = {
            jsonrpc: "2.0",
            error: { code: -32601, message: "Method not found" },
            id: requestData.id
        };
    }

    res.json(responseData);
    console.log(`[DEBUG] Sent response: ${JSON.stringify(responseData)}`);
});

// Serve .well-known/agent.json
app.get('/.well-known/agent.json', (req: Request, res: Response) => {
    const agentJsonPath = './.well-known/claude_agent.json';
    fs.readFile(agentJsonPath, 'utf8', (err, data) => {
        if (err) {
            console.error("Error reading agent.json:", err);
            res.status(404).send("Not Found");
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.send(data);
        }
    });
});

app.listen(PORT, () => {
    console.log(`Claude agent (Node.js HTTP Server) is running on http://localhost:${PORT}`);
});