import json, subprocess, time

QUEUE_FILE = 'message_queue/inbound_gemini.json'

def run_gemini_cli(prompt):
    cmd = ["genai", "chat", "--model", "gemini-pro", "--prompt", prompt]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout.strip()

def main():
    print("Gemini agent is running...")
    while True:
        try:
            with open(QUEUE_FILE, 'r+') as f:
                data = json.load(f)
                if data:
                    print(" New task received for Gemini!")
                    output = run_gemini_cli(data['payload'])

                    response = {
                        "from": "gemini",
                        "to": data['from'],
                        "type": "TaskCompleted",
                        "payload": output
                    }

                    with open(f"message_queue/inbound_{data['from']}.json", 'w') as out_f:
                        json.dump(response, out_f, indent=2)

                    f.seek(0)
                    f.truncate()
                    json.dump({}, f)
        except json.JSONDecodeError:
            pass
        except FileNotFoundError:
            pass
        time.sleep(2)

if __name__ == "__main__":
    main()