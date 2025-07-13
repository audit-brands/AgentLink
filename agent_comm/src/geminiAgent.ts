import express from 'express';
import { Request, Response } from 'express';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = 5001;

app.use(express.json());

// Mocked Gemini CLI function
function runGeminiCli(prompt: string): Promise<string> {
    return new Promise((resolve) => {
        console.log(`[MOCK] Gemini CLI received prompt: ${prompt}`);
        resolve("Mocked Gemini response: Code reviewed and approved.");
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

        console.log(" New refactor task received for Gemini!");
        console.log(`[DEBUG] Code path: ${params.code_path}, Instruction: ${params.instruction}`);
        
        const output = await runGeminiCli(`Refactor the code at ${params.code_path} with the following instruction: ${params.instruction}`);
        console.log(`[DEBUG] Hardcoded Gemini output: ${output}`);

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
    const agentJsonPath = path.join(__dirname, '..', '.well-known', 'gemini_agent.json');
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
    console.log(`Gemini agent (Node.js HTTP Server) is running on http://localhost:${PORT}`);
});