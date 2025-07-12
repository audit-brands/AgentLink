import json, subprocess, time, os

QUEUE_FILE = 'message_queue/inbound_claude.json'

def run_claude_cli(prompt):
    print(f"[MOCK] Claude CLI received prompt: {prompt}")
    return "Mocked Claude response: Code refactored successfully."

def main():
    print("Claude agent is running...")
    # Process a single message and exit for debugging
    try:
        if os.path.exists(QUEUE_FILE) and os.path.getsize(QUEUE_FILE) > 0:
            with open(QUEUE_FILE, 'r+') as f:
                try:
                    data = json.load(f)
                    print(f"[DEBUG] Data loaded: {data}")
                except json.JSONDecodeError:
                    f.seek(0)
                    f.truncate()
                    json.dump({}, f)
                    print(f"Warning: {QUEUE_FILE} contained invalid JSON. Cleared.")
                    return # Exit after clearing invalid JSON

                if data and data.get("jsonrpc") == "2.0":
                    method = data.get("method")
                    params = data.get("params", {})
                    message_id = data.get("id")
                    print(f"[DEBUG] Method: {method}, Params: {params}, ID: {message_id}")

                    if method == "RequestRefactor":
                        print(" New refactor task received for Claude!")
                        code_path = params.get("code_path")
                        instruction = params.get("instruction")
                        prompt = f"Refactor the code at {code_path} with the following instruction: {instruction}"
                        print(f"[DEBUG] Running Claude CLI with prompt: {prompt}")
                        output = run_claude_cli(prompt)
                        print(f"[DEBUG] Claude CLI output: {output}")

                        response = {
                            "jsonrpc": "2.0",
                            "result": {
                                "from": "claude",
                                "to": params.get("from"),
                                "type": "TaskCompleted",
                                "payload": output
                            },
                            "id": message_id
                        }
                        print(f"[DEBUG] Response prepared: {response}")

                        # Write response to the sender's queue
                        with open(f"message_queue/inbound_{params.get("from")}.json", 'w') as out_f:
                            json.dump(response, out_f, indent=2)

                        # Clear the current queue file after processing
                        with open(QUEUE_FILE, 'w') as f_clear:
                            json.dump({}, f_clear)
                        print(f"[DEBUG] Cleared {QUEUE_FILE}")
                else:
                    print(f"[DEBUG] No valid JSON-RPC message found in {QUEUE_FILE}")
        else:
            print(f"[DEBUG] {QUEUE_FILE} is empty or does not exist. Ensuring it's an empty JSON object.")
            with open(QUEUE_FILE, 'w') as f:
                json.dump({}, f)

    except FileNotFoundError:
        print(f"[DEBUG] {QUEUE_FILE} not found. Creating it.")
        with open(QUEUE_FILE, 'w') as f:
            json.dump({}, f)
    except Exception as e:
        print(f"An unexpected error occurred in Claude agent: {e}")

if __name__ == "__main__":
    main()