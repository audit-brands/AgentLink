# AgentLink Development Roadmap

This document outlines the phased development roadmap for the Inter-Agent Collaboration Protocol (IACP) within the AgentLink project, leveraging the Agent-to-Agent (A2A) protocol.

## Phased A2A Adoption

Our implementation will follow a phased approach, starting with a minimal viable proof-of-concept and gradually integrating more advanced features of the A2A protocol.

### Phase 0 (P0): Local Task Handoff with HTTP/JSON-RPC (Current Focus)

**Goal:** Enable basic one-directional task handoff between Gemini CLI and Claude Code CLI using HTTP and JSON-RPC.

**Key Tasks:**

*   Wrap Gemini CLI into a callable Node.js agent (`geminiAgent.ts`).
*   Wrap Claude CLI into a callable Node.js agent (`claudeAgent.ts`).
*   Implement HTTP server endpoints for JSON-RPC communication.
*   Define a simple JSON-RPC message schema (`method`, `params`, `id`).
*   Implement agent communication logic for one-directional flow (e.g., Gemini sends task to Claude).

**Tooling:** Node.js, TypeScript, Express.js, `child_process` for CLI invocation.

### Phase 1 (P1): Adopt A2A-style Message Format & Agent Cards

**Goal:** Transition to a more structured A2A-style JSON-RPC format and implement Agent Cards for discovery.

**Key Tasks:**

*   Refactor agent communication to fully comply with A2A JSON-RPC specifications.
*   Each agent serves a local HTTP endpoint with a `.well-known/agent.json` file for capability advertisement.
*   Implement a simple local service registry for agents to discover each other's capabilities and endpoints.

**Tooling:** Node.js, TypeScript, Express.js, A2A Node.js SDK (initial integration).

### Phase 2 (P2): Introduce Streaming & Events

**Goal:** Incorporate A2A's Server-Sent Events (SSE) for real-time progress updates and push notifications for asynchronous coordination.

**Key Tasks:**

*   Implement SSE streaming for long-running tasks (e.g., live linter feedback, test-run progress).
*   Implement push notifications for immediate alerts and state changes.

**Tooling:** Node.js, TypeScript, SSE implementation.

### Phase 3 (P3): Security Hardening & Full A2A Stack

**Goal:** Implement advanced A2A features including authentication, structured schema validation, and observability.

**Key Tasks:**

*   Add token-based authentication and permission checks.
*   Implement robust input sanitization.
*   Integrate comprehensive logging and monitoring for inter-agent communication.
*   Perform a lightweight threat assessment.

**Tooling:** Full A2A stack, security libraries.

### Phase 4 (P4): Advanced Features & Deployment

**Goal:** Implement advanced features and prepare for robust deployment.

**Key Tasks:**

*   Explore multi-agent workflows and orchestration.
*   Implement comprehensive error handling and retry mechanisms.
*   Containerization (Docker) for easy deployment.
*   Automated testing and CI/CD integration.

**Tooling:** Docker, CI/CD tools.
