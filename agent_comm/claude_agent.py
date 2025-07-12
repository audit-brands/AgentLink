import json
from jsonrpcserver import method, serve

@method
def RequestRefactor(code_path, instruction):
    print(" New refactor task received for Claude!")
    print(f"[DEBUG] Code path: {code_path}, Instruction: {instruction}")
    output = "Mocked Claude response: Code refactored successfully."
    print(f"[DEBUG] Hardcoded Claude output: {output}")
    return output

def main():
    print("Claude agent (JSON-RPC Server) is running on http://localhost:5000")
    serve(port=5000)

if __name__ == "__main__":
    main()