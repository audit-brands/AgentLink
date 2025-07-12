import json
from jsonrpcclient import request
import requests

# Define the JSON-RPC request
req = request("RequestRefactor", params={
    "code_path": "src/utils/math.js",
    "instruction": "Please refactor the function to improve readability."
})

# Send the request to the Claude agent server
try:
    response = requests.post("http://localhost:5000", json=req)
    response.raise_for_status() # Raise an exception for HTTP errors
    print(f"Raw Response from Claude: {response.text}")
    print(f"Response from Claude: {response.json()}")
except requests.exceptions.ConnectionError:
    print("Error: Could not connect to Claude agent. Is it running?")
except requests.exceptions.RequestException as e:
    print(f"An error occurred: {e}")