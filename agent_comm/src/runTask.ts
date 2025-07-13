import axios from 'axios';

async function runTask() {
    const requestPayload = {
        jsonrpc: "2.0",
        method: "RequestRefactor",
        params: {
            code_path: "src/utils/math.js",
            instruction: "Please refactor the function to improve readability."
        },
        id: 1
    };

    try {
        // Send request to Claude agent (port 5000)
        let response = await axios.post("http://localhost:5000", requestPayload);
        console.log(`Raw Response from Claude: ${JSON.stringify(response.data)}`);
        console.log(`Parsed JSON Response from Claude: ${JSON.stringify(response.data)}`);

        // Send request to Gemini agent (port 5001)
        response = await axios.post("http://localhost:5001", requestPayload);
        console.log(`Raw Response from Gemini: ${JSON.stringify(response.data)}`);
        console.log(`Parsed JSON Response from Gemini: ${JSON.stringify(response.data)}`);

    } catch (error: any) {
        if (axios.isAxiosError(error)) {
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