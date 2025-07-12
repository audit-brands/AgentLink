import requests
import json

# Define the JSON-RPC request payload
request_payload = {
    "jsonrpc": "2.0",
    "method": "RequestRefactor",
    "params": {
        "code_path": "src/utils/math.js",
        "instruction": "Please refactor the function to improve readability."
    },
    "id": 1
}

# Send the request to the Claude agent server
try:
    response = requests.post("http://localhost:5000", json=request_payload)
    response.raise_for_status() # Raise an exception for HTTP errors
    print(f"Raw Response from Claude: {response.text}")
    print(f"Parsed JSON Response from Claude: {response.json()}")
except requests.exceptions.ConnectionError:
    print("Error: Could not connect to Claude agent. Is it running?")
except requests.exceptions.RequestException as e:
    print(f"An error occurred: {e}")