import json
from http.server import BaseHTTPRequestHandler, HTTPServer

class ClaudeAgentHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        request_data = json.loads(post_data.decode('utf-8'))

        print(f"[DEBUG] Received request: {request_data}")

        response_data = {}
        if request_data.get("jsonrpc") == "2.0" and request_data.get("method") == "RequestRefactor":
            params = request_data.get("params", {})
            message_id = request_data.get("id")

            print(" New refactor task received for Claude!")
            print(f"[DEBUG] Code path: {params.get("code_path")}, Instruction: {params.get("instruction")}")
            
            output = "Mocked Claude response: Code refactored successfully."
            print(f"[DEBUG] Hardcoded Claude output: {output}")

            response_data = {
                "jsonrpc": "2.0",
                "result": "Mocked Claude response: Code refactored successfully.",
                "id": message_id
            }
        else:
            response_data = {
                "jsonrpc": "2.0",
                "error": {"code": -32601, "message": "Method not found"},
                "id": request_data.get("id")
            }

        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response_data).encode('utf-8'))
        print(f"[DEBUG] Sent response: {response_data}")

def main():
    print("Claude agent (HTTP Server) is running on http://localhost:5000")
    server_address = ('localhost', 5000)
    httpd = HTTPServer(server_address, ClaudeAgentHandler)
    httpd.serve_forever()

if __name__ == "__main__":
    main()