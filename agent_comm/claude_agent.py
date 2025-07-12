import json
from jsonrpcserver import method, serve

# Mocked Claude CLI function
def run_claude_cli(prompt):
    print(f"[MOCK] Claude CLI received prompt: {prompt}")
    return "Mocked Claude response: Code refactored successfully."

@method
def RequestRefactor(code_path, instruction):
    print(" New refactor task received for Claude!")
    prompt = f"Refactor the code at {code_path} with the following instruction: {instruction}"
    output = run_claude_cli(prompt)
    return {"from": "claude", "type": "TaskCompleted", "payload": output}

def main():
    print("Claude agent (JSON-RPC Server) is running on http://localhost:5000")
    serve(port=5000)

if __name__ == "__main__":
    main()