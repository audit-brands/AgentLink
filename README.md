# AgentLink

AgentLink is a Node.js/TypeScript-based orchestration layer for managing and coordinating AI agent interactions.

## Architecture

The system consists of:
- Core orchestration layer for task management and routing
- Agent wrappers for Claude and Gemini
- JSON-RPC 2.0 compliant communication protocol
- Express.js-based HTTP endpoints

## Agent Management

### Starting Agents

Agents can be started individually using npm scripts:

```bash
# Start Claude agent (runs on port 5000)
npm run start:claude

# Start Gemini agent (runs on port 5001)
npm run start:gemini

# Start both agents in separate terminals
npm run start:claude & npm run start:gemini
```

### Stopping Agents

There are multiple ways to stop the agents:

1. Using Ctrl+C in the terminal
   ```bash
   # Press Ctrl+C in the agent's terminal
   ^C
   ```

2. Using process signals
   ```bash
   # Stop by port number
   kill $(lsof -t -i:5000)  # Stop Claude agent
   kill $(lsof -t -i:5001)  # Stop Gemini agent

   # Stop by process name
   pkill -f "claudeAgent.js"
   pkill -f "geminiAgent.js"
   ```

Both methods trigger a graceful shutdown that:
1. Logs the shutdown operation
2. Sets agent status to OFFLINE
3. Deregisters from the agent registry
4. Exits cleanly with code 0

### Agent Status

Agents have three possible states:
- ONLINE: Ready to accept tasks
- BUSY: Currently processing a task
- OFFLINE: Not available for tasks

You can check an agent's status via its info endpoint:
```bash
# For Claude agent
curl http://localhost:5000/.well-known/agent.json

# For Gemini agent
curl http://localhost:5001/.well-known/agent.json
```

## Development

### Prerequisites
- Node.js 18+
- npm 9+

### Setup
```bash
# Install dependencies
cd agent_comm
npm install

# Build the project
npm run build

# Run tests
npm test
```

### Project Structure
```
agent_comm/
├── src/
│   ├── claudeAgent.ts    # Claude CLI wrapper
│   ├── geminiAgent.ts    # Gemini CLI wrapper
│   ├── services/         # Core services
│   └── types/           # TypeScript types
├── tests/               # Test files
└── package.json        # Project configuration
```