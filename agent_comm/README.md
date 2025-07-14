# AgentLink - Agent Communication Module

This module is the core communication layer for the AgentLink project, facilitating inter-agent communication using HTTP and JSON-RPC. It is implemented in Node.js with TypeScript, leveraging its asynchronous I/O capabilities for efficient and robust message passing.

## Project Structure

- `src/`: Contains the TypeScript source code for the agents and communication logic.
- `dist/`: Compiled JavaScript output.
- `claude-cli`, `gemini-cli`: Dummy shell scripts representing external CLI tools that agents interact with.
- `.well-known/`: Contains agent discovery files (e.g., `claude_agent.json`, `gemini_agent.json`).

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm (Node Package Manager)

### Installation

Navigate to the `agent_comm` directory and install the dependencies:

```bash
npm install
```

### Building the Project

Compile the TypeScript code to JavaScript:

```bash
npm run build
```

### Running the Agents

To start the Claude agent (listening on port 5000):

```bash
npm run start:claude
```

To start the Gemini agent (listening on port 5001):

```bash
npm run start:gemini
```

These commands will run the agents in the foreground. For background execution, you can use `&` (e.g., `npm run start:claude &`).

### Running the Task Runner

The `runTask.ts` script demonstrates how to send requests to the agents:

```bash
npm run start:task
```

This will send a sample `RequestRefactor` task to both Claude and Gemini agents and print their responses to the console.

## Development

### Linting

(Add linting commands if available)

### Testing

(Add testing commands if available)

## Key Decisions Reflected in this Module

This module's design reflects the decision to pivot from a Python-based, file-queue system to a Node.js/TypeScript-based HTTP/JSON-RPC communication scaffold. This pivot was made to leverage Node.js's strengths in concurrent I/O and its native fit for the A2A protocol, ensuring a more stable, performant, and maintainable foundation. The use of TypeScript provides type safety, improved code quality, and enhanced developer experience for this critical communication layer.