import json, subprocess, time, os

QUEUE_FILE = 'message_queue/inbound_gemini.json'

def run_gemini_cli(prompt):
    cmd = ["genai", "chat", "--model", "gemini-pro", "--prompt", prompt]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout.strip()

def main():
    print("Gemini agent is running...")
    while True:
        try:
            if os.path.exists(QUEUE_FILE) and os.path.getsize(QUEUE_FILE) > 0:
                with open(QUEUE_FILE, 'r+') as f:
                    try:
                        data = json.load(f)
                    except json.JSONDecodeError:
                        # File is not valid JSON, clear it or handle as error
                        f.seek(0)
                        f.truncate()
                        json.dump({}, f)
                        print(f"Warning: {QUEUE_FILE} contained invalid JSON. Cleared.")
                        time.sleep(2)
                        continue

                    if data:
                        print(" New task received for Gemini!")
                        output = run_gemini_cli(data['payload'])

                        response = {
                            "from": "gemini",
                            "to": data['from'],
                            "type": "TaskCompleted",
                            "payload": output
                        }

                        # Write response to the sender's queue
                        with open(f"message_queue/inbound_{data['from']}.json", 'w') as out_f:
                            json.dump(response, out_f, indent=2)

                        # Clear the current queue file after processing
                        f.seek(0)
                        f.truncate()
                        json.dump({}, f)
            else:
                # Ensure the file exists and is an empty JSON object if it's new or empty
                with open(QUEUE_FILE, 'w') as f:
                    json.dump({}, f)

        except FileNotFoundError:
            # Create the file if it doesn't exist
            with open(QUEUE_FILE, 'w') as f:
                json.dump({}, f)
        except Exception as e:
            print(f"An unexpected error occurred in Gemini agent: {e}")
        time.sleep(2)

if __name__ == "__main__":
    main()