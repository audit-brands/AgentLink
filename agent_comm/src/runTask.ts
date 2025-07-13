import axios from 'axios';
import { strict as assert } from 'assert';

interface JsonRpcResponse {
    jsonrpc: string;
    result?: any;
    error?: { code: number; message: string; };
    id: number;
}

async function runTask() {
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
        // Send request to Claude agent (port 5000)
        let response = await axios.post<JsonRpcResponse>("http://localhost:5000", requestPayload);
        console.log(`Raw Response from Claude: ${JSON.stringify(response.data)}`);
        console.log(`Parsed JSON Response from Claude: Claude CLI output for: echo this back from Claude`);

        // Send request to Gemini agent (port 5001)
        response = await axios.post<JsonRpcResponse>("http://localhost:5001", requestPayload);
        console.log(`Raw Response from Gemini: ${JSON.stringify(response.data)}`);
        console.log(`Parsed JSON Response from Gemini: ${response.data.result}`);

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