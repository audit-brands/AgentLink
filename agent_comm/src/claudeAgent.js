import express from 'express';
import fs from 'fs';
const app = express();
const PORT = 5000;
app.use(express.json());
// Mocked Claude CLI function
function runClaudeCli(prompt) {
    return new Promise((resolve) => {
        console.log(`[MOCK] Claude CLI received prompt: ${prompt}`);
        resolve("Mocked Claude response: Code refactored successfully.");
    });
}
// JSON-RPC endpoint
app.post('/', async (req, res) => {
    const requestData = req.body;
    console.log(`[DEBUG] Received request: ${JSON.stringify(requestData)}`);
    let responseData = {};
    if (requestData.jsonrpc === "2.0" && requestData.method === "RequestRefactor") {
        const params = requestData.params || {};
        const messageId = requestData.id;
        console.log(" New refactor task received for Claude!");
        console.log(`[DEBUG] Code path: ${params.code_path}, Instruction: ${params.instruction}`);
        const output = await runClaudeCli(`Refactor the code at ${params.code_path} with the following instruction: ${params.instruction}`);
        console.log(`[DEBUG] Hardcoded Claude output: ${output}`);
        responseData = {
            jsonrpc: "2.0",
            result: output,
            id: messageId
        };
    }
    else {
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
app.get('/.well-known/agent.json', (req, res) => {
    const agentJsonPath = './.well-known/claude_agent.json';
    fs.readFile(agentJsonPath, 'utf8', (err, data) => {
        if (err) {
            console.error("Error reading agent.json:", err);
            res.status(404).send("Not Found");
        }
        else {
            res.setHeader('Content-Type', 'application/json');
            res.send(data);
        }
    });
});
app.listen(PORT, () => {
    console.log(`Claude agent (Node.js HTTP Server) is running on http://localhost:${PORT}`);
});
