# Project Decisions

This document outlines key architectural and technological decisions made during the development of the AgentLink project, along with their rationale.

## Decision 1: Pivot from Python to Node.js for Core Communication Scaffold

**Date:** July 11, 2025

**Context:**
Initially, a Python-based scaffold was implemented for the AgentLink Proof of Concept (PoC), utilizing file-based message queues and basic `subprocess` calls to wrap existing CLI agents (Gemini and Claude). During early development and debugging, several persistent issues were encountered:

*   **Background Process Stability:** Agents running in the background using `&` in shell commands proved unstable, often exiting prematurely or failing to process messages reliably.
*   **File I/O Polling:** The initial file-based polling mechanism (`time.sleep()` and `os.path.getmtime()`) was inefficient and prone to race conditions or missed events, leading to messages not being processed or files not being cleared.
*   **Debugging Difficulty:** Debugging issues related to `subprocess` calls and file I/O in a multi-process, polling-based Python environment was time-consuming and complex.
*   **CLI Invocation Challenges:** Passing complex prompts and handling varied output from external CLIs via `subprocess.run` introduced syntax and escaping challenges.

**Problem:** The current Python scaffold was hindering rapid iteration and proving to be an unreliable foundation for the core communication layer, despite its initial simplicity for CLI wrapping.

**Decision:** To pivot the core agent communication scaffold from Python to Node.js.

**Rationale:**
Node.js offers several advantages that directly address the encountered problems and align better with the long-term goals of the AgentLink project, particularly the adoption of the A2A protocol:

*   **Concurrent I/O Handling:** Node.js excels at non-blocking, event-driven I/O, making it highly suitable for managing concurrent network connections (HTTP/WebSockets) and file system events. This is crucial for efficient agent polling, real-time streaming, and robust message passing.
*   **Native Fit for A2A:** The A2A protocol leverages JSON-RPC 2.0 over HTTP(S) and Server-Sent Events (SSE). Node.js has mature, performant, and idiomatic libraries for implementing these protocols natively.
*   **JSON-Native:** JavaScript (and by extension, Node.js) is inherently JSON-native, simplifying the parsing, manipulation, and serialization of agent messages, which are JSON-based.
*   **Process Management:** Node.js provides robust `child_process` modules for managing external CLI processes, offering better control and error handling compared to simple shell backgrounding.
*   **Event-Driven Architecture:** Node.js's event-driven nature naturally supports the kind of reactive, message-passing system envisioned for inter-agent communication.
*   **Community & Ecosystem:** A large and active ecosystem of packages for networking, process management, and development tooling.

**Impact:** This pivot is expected to provide a more stable, performant, and maintainable foundation for the AgentLink communication layer, accelerating future development and integration with the A2A protocol.

## Decision 2: Use TypeScript for Node.js Implementation

**Date:** July 11, 2025

**Context:**
With the decision to pivot to Node.js, the choice between JavaScript (JS) and TypeScript (TS) for the implementation language needed to be made. While JS offers initial development speed due to its dynamic nature, TS provides static type checking, which can introduce a perceived overhead during development but offers significant long-term benefits.

**Problem:** Balancing initial development velocity with long-term maintainability, robustness, and team collaboration for a critical communication protocol.

**Decision:** To implement the Node.js core communication scaffold using TypeScript.

**Rationale:**
Despite the potential for a steeper initial learning curve or stricter compilation, TypeScript's advantages are paramount for a project like AgentLink:

*   **Type Safety:** TypeScript's static type checking catches a wide range of errors *before* runtime, preventing subtle bugs related to data types, missing properties, or incorrect function arguments. This is invaluable for a distributed system where agents exchange structured messages.
*   **Protocol Enforcement:** The A2A protocol defines clear message schemas (e.g., Agent Cards, JSON-RPC requests/responses). TypeScript interfaces and types can directly model these schemas, ensuring that all agents adhere to the communication contract. This is critical for interoperability and preventing runtime errors due to malformed messages.
*   **Improved Code Quality and Maintainability:** Explicit type definitions make the codebase easier to understand, navigate, and refactor. This is especially beneficial as the project grows in complexity and more developers potentially contribute.
*   **Enhanced Developer Experience:** Modern IDEs provide superior autocompletion, intelligent refactoring, and inline error feedback when working with TypeScript, significantly boosting developer productivity and reducing debugging time.
*   **Scalability for Collaboration:** For a multi-agent system that will evolve, TypeScript provides a strong foundation for managing complexity and ensuring consistency across different components and future integrations.
*   **Self-Documenting Code:** Type annotations serve as a form of living documentation, clearly indicating the expected data structures and function signatures.

**Impact:** While there might be a slight initial overhead in defining types, the long-term benefits of increased reliability, reduced debugging time, improved maintainability, and clearer inter-agent contracts far outweigh this. TypeScript will ensure the AgentLink communication layer is robust and scalable.