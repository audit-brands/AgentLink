import json

message = {
    "from": "gemini",
    "to": "claude",
    "type": "RequestRefactor",
    "payload": "Please refactor the function in src/utils/math.js to improve readability."
}

with open("message_queue/inbound_claude.json", "w") as f:
    json.dump(message, f, indent=2)

print(" Task sent to Claude.")