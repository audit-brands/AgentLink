# AgentLink Development Roadmap

This document outlines the phased development roadmap for the Inter-Agent Collaboration Protocol (IACP) within the AgentLink project, leveraging the Agent-to-Agent (A2A) protocol with multi-agent orchestration.

## Phased A2A Adoption

Our implementation will follow a phased approach, starting with a minimal viable proof-of-concept and gradually integrating more advanced features of the A2A protocol, incorporating orchestration between sub-agents where appropriate.

### Phase 0 (P0): Local Task Handoff with HTTP/JSON-RPC (Current Focus)

**Goal:** Enable basic one-directional task handoff between Gemini CLI and Claude Code CLI using HTTP and JSON-RPC, with foundational orchestration support.

**Key Tasks:**

*   Wrap Gemini CLI into a callable Node.js agent (`geminiAgent.ts`).
*   Wrap Claude CLI into a callable Node.js agent (`claudeAgent.ts`).
*   Implement HTTP server endpoints for JSON-RPC communication.
*   Define a simple JSON-RPC message schema (`method`, `params`, `id`).
*   Implement agent communication logic for one-directional flow (e.g., Gemini sends task to Claude).
*   Add basic orchestration layer for task routing between agents.
*   Implement task queue management for coordinated execution.

**Tooling:** Node.js, TypeScript, Express.js, `child_process` for CLI invocation, Redis/Bull for task queues.

### Phase 1 (P1): Adopt A2A-style Message Format & Agent Cards with Orchestration

**Goal:** Transition to a more structured A2A-style JSON-RPC format and implement Agent Cards for discovery, with enhanced orchestration capabilities.

**Key Tasks:**

*   Refactor agent communication to fully comply with A2A JSON-RPC specifications.
*   Each agent serves a local HTTP endpoint with a `.well-known/agent.json` file for capability advertisement.
*   Implement a simple local service registry for agents to discover each other's capabilities and endpoints.
*   Develop orchestrator service for dynamic task routing based on agent capabilities.
*   Implement agent state management and coordination patterns.
*   Add support for parallel task execution across multiple agents.

**Tooling:** Node.js, TypeScript, Express.js, A2A Node.js SDK (initial integration), Redis for state management.

### Phase 2 (P2): Introduce Streaming & Events with Coordinated Workflows

**Goal:** Incorporate A2A's Server-Sent Events (SSE) for real-time progress updates and push notifications for asynchronous coordination, with workflow orchestration.

**Key Tasks:**

*   Implement SSE streaming for long-running tasks (e.g., live linter feedback, test-run progress).
*   Implement push notifications for immediate alerts and state changes.
*   Develop workflow engine for complex multi-agent task sequences.
*   Add support for conditional branching in workflows.
*   Implement rollback mechanisms for failed workflow steps.
*   Create monitoring dashboard for workflow status.

**Tooling:** Node.js, TypeScript, SSE implementation, workflow engine (e.g., Temporal.io or custom).

### Phase 3 (P3): Security Hardening & Full A2A Stack with Access Control

**Goal:** Implement advanced A2A features including authentication, structured schema validation, and observability, with secure orchestration.

**Key Tasks:**

*   Add token-based authentication and permission checks.
*   Implement robust input sanitization.
*   Integrate comprehensive logging and monitoring for inter-agent communication.
*   Perform a lightweight threat assessment.
*   Implement role-based access control for orchestration commands.
*   Add audit logging for all orchestration actions.
*   Develop security policies for inter-agent communication.

**Tooling:** Full A2A stack, security libraries, RBAC implementation.

### Phase 4 (P4): Advanced Features & Deployment with Distributed Orchestration

**Goal:** Implement advanced features and prepare for robust deployment, including distributed orchestration capabilities.

**Key Tasks:**

*   Explore multi-agent workflows and orchestration patterns.
*   Implement comprehensive error handling and retry mechanisms.
*   Containerization (Docker) for easy deployment.
*   Automated testing and CI/CD integration.
*   Develop distributed orchestration capabilities:
    - Leader election for orchestrator redundancy
    - Distributed task scheduling
    - Cross-node workflow coordination
    - Global state management
*   Implement advanced monitoring and debugging tools:
    - Workflow visualization
    - Performance metrics
    - Distributed tracing
*   Add support for dynamic agent scaling.
*   Implement cross-environment orchestration.

**Tooling:** Docker, CI/CD tools, distributed systems libraries (e.g., etcd), monitoring stack.

## Orchestration Architecture

The orchestration layer is designed to evolve alongside the phased implementation:

### Phase 0-1: Basic Orchestration
- Simple task routing
- Sequential execution
- Local state management
- Basic error handling

### Phase 2: Workflow Orchestration
- Complex task sequences
- Parallel execution
- Conditional branching
- State persistence

### Phase 3: Secure Orchestration
- Access control
- Audit logging
- Security policies
- Monitoring

### Phase 4: Distributed Orchestration
- Multi-node coordination
- High availability
- Global state
- Advanced monitoring

## Success Criteria

Each phase must meet these orchestration-specific criteria before proceeding:

1. **Reliability:** Orchestration layer handles failures gracefully
2. **Scalability:** Supports increasing number of agents and tasks
3. **Observability:** Provides clear insight into workflow status
4. **Security:** Enforces proper access controls and audit trails
5. **Performance:** Maintains acceptable latency under load

## Phase 4 Implementation Strategy Update

The Phase 4 implementation will follow a progressive approach, focusing first on local system optimization before expanding to network capabilities:

### Phase 4.1: Local System Optimization (Current Focus)
**Goal:** Perfect single-system agent orchestration with efficient resource usage.

**Key Tasks:**
- Optimize resource management (memory, CPU, storage)
- Enhance local workflow orchestration
- Improve agent lifecycle management
- Implement comprehensive monitoring
- Establish performance baselines

**Success Criteria:**
- Memory usage < 8GB
- Efficient CPU utilization
- Sub-second workflow initialization
- 99.9% task completion rate

### Phase 4.2: Network Capability (Future)
*To be implemented after successful completion of Phase 4.1*
- LAN/private network extension
- Public network capabilities
- Distributed orchestration
- Cross-environment coordination

This staged approach ensures robust local orchestration before scaling to network deployment.