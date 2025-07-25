import axios from 'axios';
import { strict as assert } from 'assert';
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

async function runTask() {
    let claudeAgent: any;
    let geminiAgent: any;

    // Poll for agents until both are discovered
    while (!claudeAgent || !geminiAgent) {
        claudeAgent = agentRegistry.getAgent('claude-agent');
        geminiAgent = agentRegistry.getAgent('gemini-agent');
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
        let response = await axios.post<JsonRpcResponse>(claudeAgent.endpoint, requestPayload);
        console.log(`Raw Response from Claude: ${JSON.stringify(response.data)}`);
        if (response.data.error) {
            console.error(`JSON-RPC Error from Claude: Code ${response.data.error.code}, Message: ${response.data.error.message}, Data: ${JSON.stringify(response.data.error.data)}`);
        } else {
            console.log(`Parsed JSON Response from Claude: ${response.data.result}`);
        }

        // Send request to Gemini agent
        response = await axios.post<JsonRpcResponse>(geminiAgent.endpoint, requestPayload);
        console.log(`Raw Response from Gemini: ${JSON.stringify(response.data)}`);
        if (response.data.error) {
            console.error(`JSON-RPC Error from Gemini: Code ${response.data.error.code}, Message: ${response.data.error.message}, Data: ${JSON.stringify(response.data.error.data)}`);
        } else {
            console.log(`Parsed JSON Response from Gemini: ${response.data.result}`);
        }

    } catch (error: any) {
        if (error.isAxiosError) {
            if (error.response) {
                console.error(`Error: HTTP Status ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            } else if (error.request) {
                console.error("Error: No response received from agent. Is it running?");
            } else {
                console.error("Error setting up request:", error.message);
            }
        } else {
            console.error("An unexpected error occurred:", error);
        }
    }
}

runTask();