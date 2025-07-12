import json, subprocess, time, os

QUEUE_FILE = 'message_queue/inbound_gemini.json'

def run_gemini_cli(prompt):
    print(f"[MOCK] Gemini CLI received prompt: {prompt}")
    return "Mocked Gemini response: Code reviewed and approved."

def main():
    print("Gemini agent is running...")
    last_modified_time = 0
    while True:
        try:
            current_modified_time = os.path.getmtime(QUEUE_FILE) if os.path.exists(QUEUE_FILE) else 0

            if current_modified_time > last_modified_time and os.path.getsize(QUEUE_FILE) > 0:
                print(f"[DEBUG] {QUEUE_FILE} has been modified. Processing...")
                last_modified_time = current_modified_time

                with open(QUEUE_FILE, 'r+') as f:
                    try:
                        data = json.load(f)
                        print(f"[DEBUG] Data loaded: {data}")
                    except json.JSONDecodeError:
                        print(f"[DEBUG] JSONDecodeError in {QUEUE_FILE}. Clearing file.")
                        f.seek(0)
                        f.truncate()
                        json.dump({}, f)
                        print(f"Warning: {QUEUE_FILE} contained invalid JSON. Cleared.")
                        continue

                    if data and data.get("jsonrpc") == "2.0":
                        method = data.get("method")
                        params = data.get("params", {})
                        message_id = data.get("id")
                        print(f"[DEBUG] Method: {method}, Params: {params}, ID: {message_id}")

                        if method == "RequestRefactor": # Example method, will expand later
                            print(" New refactor task received for Gemini!")
                            code_path = params.get("code_path")
                            instruction = params.get("instruction")
                            prompt = f"Refactor the code at {code_path} with the following instruction: {instruction}"
                            output = run_gemini_cli(prompt)

                            response = {
                                "jsonrpc": "2.0",
                                "result": {
                                    "from": "gemini",
                                    "to": params.get("from"),
                                    "type": "TaskCompleted",
                                    "payload": output
                                },
                                "id": message_id
                            }
                            print(f"[DEBUG] Response prepared: {response}")

                            # Write response to the sender's queue
                            response_queue_file = f"message_queue/inbound_{params.get('from')}.json"
                            print(f"[DEBUG] Writing response to: {response_queue_file}")
                            with open(response_queue_file, 'w') as out_f:
                                json.dump(response, out_f, indent=2)

                            # Clear the current queue file after processing
                            print(f"[DEBUG] Attempting to clear {QUEUE_FILE}")
                            with open(QUEUE_FILE, 'w') as f_clear:
                                json.dump({}, f_clear)
                            print(f"[DEBUG] Cleared {QUEUE_FILE}")
                            last_modified_time = os.path.getmtime(QUEUE_FILE) # Update last modified time after clearing
                    else:
                        print(f"[DEBUG] No valid JSON-RPC message found in {QUEUE_FILE}")
            elif not os.path.exists(QUEUE_FILE):
                print(f"[DEBUG] {QUEUE_FILE} not found. Creating it.")
                with open(QUEUE_FILE, 'w') as f:
                    json.dump({}, f)
                last_modified_time = os.path.getmtime(QUEUE_FILE) # Update after creation

        except Exception as e:
            print(f"An unexpected error occurred in Gemini agent: {e}")
        time.sleep(1) # Shorter sleep for more active polling

if __name__ == "__main__":
    main()