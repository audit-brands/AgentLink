import json
import requests
import time

AGENTS = [
    {"id": "claude-agent", "endpoint": "http://localhost:5000"},
    {"id": "gemini-agent", "endpoint": "http://localhost:5001"}
]

REGISTERED_AGENTS = {}

def discover_agent(agent_info):
    agent_id = agent_info["id"]
    endpoint = agent_info["endpoint"]
    agent_json_url = f"{endpoint}/.well-known/agent.json"
    
    try:
        response = requests.get(agent_json_url, timeout=2)
        response.raise_for_status() # Raise an exception for HTTP errors
        agent_card = response.json()
        REGISTERED_AGENTS[agent_id] = {
            "endpoint": endpoint,
            "capabilities": agent_card.get("capabilities", []),
            "status": "active"
        }
        print(f"[REGISTRY] Discovered and registered agent: {agent_id} with capabilities {REGISTERED_AGENTS[agent_id]["capabilities"]}")
    except requests.exceptions.RequestException as e:
        if agent_id in REGISTERED_AGENTS:
            REGISTERED_AGENTS[agent_id]["status"] = "inactive"
            print(f"[REGISTRY] Agent {agent_id} became inactive: {e}")
        else:
            print(f"[REGISTRY] Agent {agent_id} is not reachable: {e}")

def main():
    print("[REGISTRY] Starting agent discovery service...")
    while True:
        for agent_info in AGENTS:
            discover_agent(agent_info)
        print("[REGISTRY] Current Registered Agents:")
        for agent_id, info in REGISTERED_AGENTS.items():
            print(f"  - {agent_id}: Status={info["status"]}, Capabilities={info["capabilities"]}")
        time.sleep(5)

if __name__ == "__main__":
    main()