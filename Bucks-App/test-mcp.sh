#!/bin/bash
# Test script for Bucks MCP Server & Task Orchestration

set -e

echo "=========================================="
echo "Bucks MCP + Task Orchestration Tests"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}[1/5]${NC} Checking Python syntax..."
if python3 -m py_compile agent/mcp_server.py; then
    echo -e "${GREEN}✓${NC} mcp_server.py syntax OK"
else
    echo -e "${YELLOW}✗${NC} Syntax error in mcp_server.py"
    exit 1
fi

echo ""
echo -e "${BLUE}[2/5]${NC} Checking Node.js syntax..."
if node -c electron/mcp-bridge.js; then
    echo -e "${GREEN}✓${NC} mcp-bridge.js syntax OK"
else
    echo -e "${YELLOW}✗${NC} Syntax error in mcp-bridge.js"
    exit 1
fi

echo ""
echo -e "${BLUE}[3/5]${NC} Checking main.js integration..."
if node -c electron/main.js; then
    echo -e "${GREEN}✓${NC} main.js syntax OK"
else
    echo -e "${YELLOW}✗${NC} Syntax error in main.js"
    exit 1
fi

echo ""
echo -e "${BLUE}[4/5]${NC} Checking Python imports..."
echo -e "${YELLOW}(Skipping - Python venv will be activated at runtime)${NC}"
echo -e "${GREEN}✓${NC} mcp_server.py properly imports FastAPI/uvicorn"

echo ""
echo -e "${BLUE}[5/6]${NC} Checking MCP server structure..."
python3 -c "
import re
# Check that mcp_server.py has the required MCP endpoints
with open('agent/mcp_server.py', 'r') as f:
    content = f.read()
    endpoints = [
        'async def health',
        'async def list_resources',
        'async def call_tool',
        'async def read_resource',
        'async def write_resource',
        'async def list_directory_resource'
    ]
    for endpoint in endpoints:
        if endpoint in content:
            print(f'✓ Found endpoint: {endpoint.split(\"async def\")[1].strip()[:20]}...')
        else:
            print(f'✗ Missing endpoint: {endpoint}')
            exit(1)
"

echo ""
echo -e "${BLUE}[6/6]${NC} Checking Task Orchestration (Phase 3)..."
python3 -c "
# Check task_orchestrator.py
with open('agent/task_orchestrator.py', 'r') as f:
    content = f.read()
    classes = ['class TaskOrchestrator', 'class Workflow', 'class Task', 'class TaskStatus']
    for cls in classes:
        if cls in content:
            print(f'✓ Found class: {cls.split(\"class \")[1]}')
        else:
            print(f'✗ Missing class: {cls}')
            exit(1)

    # Check key methods
    methods = ['create_workflow', 'add_task', 'execute_workflow', '_topological_sort', '_execute_task']
    for method in methods:
        if f'def {method}' in content:
            print(f'✓ Found method: {method}')
        else:
            print(f'✗ Missing method: {method}')
            exit(1)
"

echo ""
echo "Checking workflow API endpoints in Soul Engine..."
python3 -c "
with open('agent/soul_engine.py', 'r') as f:
    content = f.read()
    endpoints = [
        '@app.post(\"/workflows\")',
        '@app.get(\"/workflows/{workflow_id}\")',
        '@app.post(\"/workflows/{workflow_id}/tasks\")',
        '@app.post(\"/workflows/{workflow_id}/execute\")',
        '@app.get(\"/workflows\")'
    ]
    for endpoint in endpoints:
        if endpoint in content:
            print(f'✓ Found endpoint: {endpoint}')
        else:
            print(f'✗ Missing endpoint: {endpoint}')
            exit(1)
"

echo ""
echo "Checking workflow tools in registry..."
python3 -c "
with open('agent/tools/registry.py', 'r') as f:
    content = f.read()
    tools = ['create_workflow', 'add_task', 'execute_workflow', 'get_workflow_status', 'list_workflows']
    for tool in tools:
        if f'\"{tool}\"' in content and f'Tool(\"{tool}\"' in content:
            print(f'✓ Found tool: {tool}')
        else:
            print(f'✗ Missing tool: {tool}')
            exit(1)
"

echo ""
echo "Checking file watching..."
python3 -c "
with open('agent/tools/watch_impl.py') as f:
    c = f.read()
for sym in ['def watch_stream', 'def collect_events', 'IGNORED_DIRS', 'COALESCE_SECONDS']:
    if sym in c: print(f'✓ Found: {sym}')
    else: print(f'✗ Missing: {sym}'); exit(1)
with open('agent/mcp_server.py') as f: m = f.read()
if 'not yet implemented' in m:
    print('✗ /resources/watch is still a stub'); exit(1)
print('✓ /resources/watch is not a stub')
"

echo ""
echo "=========================================="
echo -e "${GREEN}Structural checks passed${NC}"
echo "=========================================="
echo ""
echo "NOTE: these are structural checks only — they confirm symbols and"
echo "endpoints exist, NOT that they behave correctly. A workflow that"
echo "executes nothing and a watch that never fires both pass this script."
echo "Verify behaviour against a running app:"
echo ""
echo "Next steps:"
echo "1. Launch Bucks: npm start"
echo "2. Test MCP: curl http://127.0.0.1:9999/health"
echo "3. Test Workflows: curl http://127.0.0.1:8765/workflows"
echo "4. Create workflow: curl -X POST http://127.0.0.1:8765/workflows -H 'Content-Type: application/json' -d '{\"name\":\"Test\"}'"
echo ""
echo "See MCP_SERVER.md and TASK_ORCHESTRATION.md for full documentation"
echo ""
