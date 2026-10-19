"""Test-wide setup that has to happen before the servers are imported."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# soul_engine and mcp_server install token auth at import time. A fixed token
# here keeps the suite from reading or creating the developer's real
# ~/.bucks/agent.token.
os.environ.setdefault('BUCKS_AGENT_TOKEN', 'test-agent-token-0123456789abcdefghijklmnopqrstuv')
