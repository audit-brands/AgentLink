"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const registry_1 = require("./registry");
async function runTask() {
    let claudeAgent;
    let geminiAgent;
    // Poll for agents until both are discovered
    while (!claudeAgent || !geminiAgent) {
        claudeAgent = registry_1.agentRegistry.getAgent('claude-agent');
        geminiAgent = registry_1.agentRegistry.getAgent('gemini-agent');
        if (!claudeAgent || !geminiAgent) {
            console.log("Waiting for agents to register...");
            console.log(`Claude Agent: ${claudeAgent ? 'Discovered' : 'Not Discovered'}`);
            console.log(`Gemini Agent: ${geminiAgent ? 'Discovered' : 'Not Discovered'}`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
        }
    }
    console.log("Agents discovered!");
    if (!claudeAgent || !geminiAgent) {
        console.error("Could not discover all agents. Make sure they are running.");
        return;
    }
    const requestPayload = {
        jsonrpc: "2.0",
        method: "RequestRefactor",
        params: {
            code_path: "src/utils/math.js",
            instruction: "echo this back from Claude"
        },
        id: 1
    };
    try {
        // Send request to Claude agent
        let response = await axios_1.default.post(claudeAgent.endpoint, requestPayload);
        console.log(`Raw Response from Claude: ${JSON.stringify(response.data)}`);
        if (response.data.error) {
            console.error(`JSON-RPC Error from Claude: Code ${response.data.error.code}, Message: ${response.data.error.message}, Data: ${JSON.stringify(response.data.error.data)}`);
        }
        else {
            console.log(`Parsed JSON Response from Claude: ${response.data.result}`);
        }
        // Send request to Gemini agent
        response = await axios_1.default.post(geminiAgent.endpoint, requestPayload);
        console.log(`Raw Response from Gemini: ${JSON.stringify(response.data)}`);
        if (response.data.error) {
            console.error(`JSON-RPC Error from Gemini: Code ${response.data.error.code}, Message: ${response.data.error.message}, Data: ${JSON.stringify(response.data.error.data)}`);
        }
        else {
            console.log(`Parsed JSON Response from Gemini: ${response.data.result}`);
        }
    }
    catch (error) {
        if (error.isAxiosError) {
            if (error.response) {
                console.error(`Error: HTTP Status ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            }
            else if (error.request) {
                console.error("Error: No response received from agent. Is it running?");
            }
            else {
                console.error("Error setting up request:", error.message);
            }
        }
        else {
            console.error("An unexpected error occurred:", error);
        }
    }
}
runTask();
