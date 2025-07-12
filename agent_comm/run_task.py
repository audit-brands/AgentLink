import json

message = {
    "jsonrpc": "2.0",
    "method": "RequestRefactor",
    "params": {
        "from": "gemini",
        "to": "claude",
        "code_path": "src/utils/math.js",
        "instruction": "Please refactor the function to improve readability."
    },
    "id": 1
}

with open("message_queue/inbound_claude.json", "w") as f:
    json.dump(message, f, indent=2)

print(" Task sent to Claude.")