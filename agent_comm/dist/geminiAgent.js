"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const registry_1 = require("./registry");
const app = (0, express_1.default)();
const PORT = 5001;
app.use(express_1.default.json());
function runGeminiCli(prompt) {
    return new Promise((resolve) => {
        const command = `${path_1.default.resolve(__dirname, '../gemini-cli')} "${prompt}"`;
        console.log(`[EXEC] Running Gemini CLI command: ${command}`);
        (0, child_process_1.exec)(command, (error, stdout, stderr) => {
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
                }
                else {
                    resolve(stdout.trim());
                }
            }
            catch (e) {
                resolve(stdout.trim()); // Not a JSON response, return as is
            }
        });
    });
}
// JSON-RPC endpoint
app.post('/', async (req, res) => {
    const requestData = req.body;
    console.log(`[DEBUG] Received request: ${JSON.stringify(requestData)}`);
    let responseData = {};
    if (requestData.jsonrpc !== "2.0") {
        responseData = {
            jsonrpc: "2.0",
            error: { code: -32600, message: "Invalid Request", data: "jsonrpc must be \"2.0\"" },
            id: requestData.id || null
        };
    }
    else if (typeof requestData.method !== "string") {
        responseData = {
            jsonrpc: "2.0",
            error: { code: -32600, message: "Invalid Request", data: "method must be a string" },
            id: requestData.id || null
        };
    }
    else if (requestData.method === "RequestRefactor") {
        const params = requestData.params || {};
        const messageId = requestData.id;
        console.log(" New refactor task received for Gemini!");
        console.log(`[DEBUG] Code path: ${params.code_path}, Instruction: ${params.instruction}`);
        const output = await runGeminiCli(params.instruction);
        if (typeof output === 'object' && output.jsonrpc === "2.0" && output.error) {
            responseData = output;
        }
        else {
            responseData = {
                jsonrpc: "2.0",
                result: output,
                id: messageId
            };
        }
    }
    else {
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
app.get('/.well-known/agent.json', (req, res) => {
    const geminiAgentCard = registry_1.agentRegistry.getAgent('gemini-agent');
    if (geminiAgentCard) {
        res.setHeader('Content-Type', 'application/json');
        res.json(geminiAgentCard);
    }
    else {
        res.status(404).send("Agent card not found");
    }
});
app.listen(PORT, async () => {
    console.log(`Gemini agent (Node.js HTTP Server) is running on http://localhost:${PORT}`);
    const agentCard = {
        id: "gemini-agent",
        capabilities: ["RequestRefactor"],
        endpoint: `http://localhost:${PORT}`
    };
    registry_1.agentRegistry.registerAgent(agentCard);
    // Periodic registration (heartbeat)
    setInterval(() => {
        registry_1.agentRegistry.registerAgent(agentCard);
    }, 30000); // Register every 30 seconds
    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('Gemini agent shutting down...');
        registry_1.agentRegistry.deregisterAgent(agentCard.id);
        process.exit();
    });
});
