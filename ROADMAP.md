# AgentLink Development Roadmap

This document outlines the phased development roadmap for the Inter-Agent Collaboration Protocol (IACP) within the AgentLink project, leveraging the Agent-to-Agent (A2A) protocol.

## Phased A2A Adoption

Our implementation will follow a phased approach, starting with a minimal viable proof-of-concept and gradually integrating more advanced features of the A2A protocol.

### Phase 0 (P0): Local Task Handoff with File-Based Queue (Current Focus)

**Goal:** Enable basic one-directional task handoff between Gemini CLI and Claude Code CLI using a simple file-based message queue.

**Key Tasks:**

*   Wrap Gemini CLI into a callable Python script (`gemini_agent.py`).
*   Wrap Claude CLI into a callable Python script (`claude_agent.py`).
*   Create a file-based JSON message relay (`message_queue/inbound_*.json`).
*   Define a simple message schema (`from`, `to`, `type`, `payload`).
*   Implement agent polling/dispatching logic for one-directional flow (e.g., Gemini sends task to Claude).

**Tooling:** Python (with `subprocess`, `json`), Filesystem-based JSON queue.

### Phase 1 (P1): Adopt A2A-style Message Format

**Goal:** Transition from the simple JSON message schema to a more structured A2A-style JSON-RPC format.

**Key Tasks:**

*   Refactor agent wrappers to send and receive A2A-compliant JSON-RPC messages.
*   Implement basic JSON-RPC client/server logic within agent wrappers.

**Tooling:** Python (with `aiohttp` or similar for HTTP server/client), A2A Python SDK (initial integration).

### Phase 2 (P2): Introduce Agent Cards & Discovery

**Goal:** Implement A2A's Agent Cards for agent discovery and capability advertisement.

**Key Tasks:**

*   Each agent serves a local HTTP endpoint with a `.well-known/agent.json` file.
*   Implement a simple local service registry for agents to discover each other's capabilities and endpoints.

**Tooling:** A2A Python SDK, local HTTP server.

### Phase 3 (P3): Add Streaming & Events

**Goal:** Incorporate A2A's Server-Sent Events (SSE) for real-time progress updates and push notifications for asynchronous coordination.

**Key Tasks:**

*   Implement SSE streaming for long-running tasks (e.g., live linter feedback, test-run progress).
*   Implement push notifications for immediate alerts and state changes.

**Tooling:** A2A Python SDK, SSE implementation.

### Phase 4 (P4): Security Hardening & Full A2A Stack

**Goal:** Implement advanced A2A features including authentication, structured schema validation, and observability.

**Key Tasks:**

*   Add token-based authentication and permission checks.
*   Implement robust input sanitization.
*   Integrate comprehensive logging and monitoring for inter-agent communication.
*   Perform a lightweight threat assessment.

**Tooling:** Full A2A stack, security libraries.
