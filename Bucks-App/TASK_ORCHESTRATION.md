# Bucks Task Orchestration — Openclaw-like Workflow System

Multi-step task execution with dependency resolution, parallel execution, and
persistent workflow tracking.

> **Verified as of 2026-08-14** against a running Soul Engine: a two-task
> workflow with a dependency executed both steps and returned real tool output;
> a cyclic workflow failed with a cycle error; workflows created in one process
> were readable from another. Known gaps are listed at the end — read them
> before relying on anything not mentioned here.

## Overview

The Task Orchestrator enables Bucks to coordinate complex, multi-step agentic workflows — similar to Openclaw's task management capabilities. Features include:

- **Workflow Creation** - Compose tasks into workflows
- **Dependency Resolution** - Automatic execution order based on task dependencies
- **Parallel Execution** - Run independent tasks simultaneously
- **Persistent Storage** - Workflows stored in SQLite for recovery
- **Status Tracking** - Real-time progress monitoring
- **Retry Logic** - Configurable retry attempts with backoff
- **Timeout Handling** - Per-task execution timeouts
- **Result Aggregation** - Collect all outputs in one place

## Architecture

```
Soul Engine (FastAPI)
├─ POST /workflows                 → Create workflow
├─ GET  /workflows                 → List all workflows
├─ GET  /workflows/{id}            → Get workflow status
├─ POST /workflows/{id}/tasks      → Add task to workflow
├─ POST /workflows/{id}/execute    → Execute workflow
│
└─ Task Orchestrator (task_orchestrator.py)
   ├─ Workflow Management
   │  ├─ create_workflow()
   │  ├─ add_task()
   │  ├─ load_workflow()
   │  └─ list_workflows()
   │
   ├─ Execution Engine
   │  ├─ execute_workflow()        → Orchestrates full run
   │  ├─ _execute_task()           → Single task with retries
   │  ├─ _topological_sort()       → Dependency resolution
   │  └─ Tool Executor             → Calls actual tools
   │
   └─ Persistence (SQLite)
      └─ workflows table           → Stores all workflows
```

## Concepts

### Workflow
A workflow is a collection of related tasks that can have dependencies on each other.

```python
{
  "workflow_id": "uuid",
  "name": "My Research Task",
  "description": "Search web and summarize",
  "status": "draft|ready|running|completed|failed|cancelled",
  "tasks": {...},
  "results": {...}
}
```

### Task
A single unit of work that executes a tool with specific arguments.

```python
{
  "task_id": "uuid",
  "name": "Search for AI news",
  "tool_name": "web_search",
  "tool_args": {"query": "latest AI advances"},
  "depends_on": [],              # List of task IDs this depends on
  "status": "pending|running|completed|failed|waiting",
  "retry_count": 0,
  "max_retries": 3,
  "timeout_seconds": 30
}
```

### Execution Flow

1. **Create Workflow**
   ```
   POST /workflows
   {"name": "My Workflow", "description": "..."}
   → Returns workflow_id
   ```

2. **Add Tasks**
   ```
   POST /workflows/{id}/tasks
   {
     "name": "Task 1",
     "tool_name": "web_search",
     "tool_args": {"query": "AI"},
     "depends_on": [],
     "max_retries": 3,
     "timeout_seconds": 30
   }
   → Returns task_id
   ```

3. **Execute Workflow**
   ```
   POST /workflows/{id}/execute
   → Orchestrator:
     1. Topologically sorts tasks by dependencies
     2. Executes independent tasks in parallel
     3. Waits for dependencies before starting dependent tasks
     4. Retries failed tasks (respecting max_retries)
     5. Returns final status and results
   ```

4. **Check Status**
   ```
   GET /workflows/{id}
   → Returns workflow status, progress, and results
   ```

## API Reference

### Create Workflow

```http
POST /workflows
Content-Type: application/json

{
  "name": "Research Task",
  "description": "Gather and analyze data"
}

Response:
{
  "workflow_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Research Task",
  "description": "Gather and analyze data",
  "status": "draft"
}
```

### List Workflows

```http
GET /workflows

Response:
{
  "count": 3,
  "workflows": [
    {
      "workflow_id": "550e8400-...",
      "name": "Research Task",
      "status": "completed",
      "tasks": 5,
      "created_at": 1693123456.123
    },
    ...
  ]
}
```

### Add Task to Workflow

```http
POST /workflows/{workflow_id}/tasks
Content-Type: application/json

{
  "name": "Search Web",
  "tool_name": "web_search",
  "tool_args": {
    "query": "Claude AI news",
    "max_results": 5
  },
  "depends_on": [],
  "description": "Search for latest news",
  "max_retries": 3,
  "timeout_seconds": 30
}

Response:
{
  "task_id": "550e8400-e29b-41d4-...",
  "name": "Search Web",
  "tool_name": "web_search",
  "status": "pending",
  "depends_on": []
}
```

### Get Workflow Status

```http
GET /workflows/{workflow_id}

Response:
{
  "workflow_id": "550e8400-...",
  "name": "Research Task",
  "status": "running",
  "progress": {
    "total": 5,
    "completed": 2,
    "failed": 0,
    "pending": 3,
    "percent": 40.0
  },
  "created_at": 1693123456.123,
  "started_at": 1693123457.456,
  "completed_at": null,
  "error": null
}
```

### Execute Workflow

```http
POST /workflows/{workflow_id}/execute

Response:
{
  "workflow_id": "550e8400-...",
  "name": "Research Task",
  "status": "completed",
  "completed_at": 1693123465.789,
  "error": null,
  "results_count": 5
}
```

## Usage Examples

### Example 1: Simple Linear Workflow

Create a 3-step workflow: search → fetch → analyze

```bash
# 1. Create workflow
curl -X POST http://127.0.0.1:8765/workflows \
  -H "Content-Type: application/json" \
  -d '{"name": "Research Pipeline"}'
# Response: {"workflow_id": "abc123", ...}

# 2. Add search task (no dependencies)
curl -X POST http://127.0.0.1:8765/workflows/abc123/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Search",
    "tool_name": "web_search",
    "tool_args": {"query": "Claude API"},
    "depends_on": []
  }'
# Response: {"task_id": "task1", ...}

# 3. Add fetch task (depends on search)
curl -X POST http://127.0.0.1:8765/workflows/abc123/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Fetch Results",
    "tool_name": "fetch_url",
    "tool_args": {"url": "https://example.com"},
    "depends_on": ["task1"]
  }'
# Response: {"task_id": "task2", ...}

# 4. Execute workflow
curl -X POST http://127.0.0.1:8765/workflows/abc123/execute
# Response: {"status": "completed", ...}

# 5. Check status
curl http://127.0.0.1:8765/workflows/abc123
```

### Example 2: Parallel Workflow

Execute independent tasks in parallel:

```bash
# Create workflow
curl -X POST http://127.0.0.1:8765/workflows \
  -H "Content-Type: application/json" \
  -d '{"name": "Parallel Search"}'
# Response: {"workflow_id": "xyz789", ...}

# Add 3 parallel search tasks (all have depends_on: [])
for query in "AI" "Machine Learning" "Neural Networks"; do
  curl -X POST http://127.0.0.1:8765/workflows/xyz789/tasks \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"Search: $query\",
      \"tool_name\": \"web_search\",
      \"tool_args\": {\"query\": \"$query\"},
      \"depends_on\": []
    }"
done

# Execute - all 3 tasks run simultaneously
curl -X POST http://127.0.0.1:8765/workflows/xyz789/execute
```

### Example 3: Complex DAG (Directed Acyclic Graph)

```
Task A (search)
├─ Task B (fetch result 1)
│  └─ Task D (analyze)
└─ Task C (fetch result 2)
   └─ Task D (analyze)  [shared dependency]
```

```bash
# Create workflow
WF="xyz789"

# Add root task (no dependencies)
TASK_A=$(curl -s -X POST http://127.0.0.1:8765/workflows/$WF/tasks \
  -H "Content-Type: application/json" \
  -d '{"name": "A", "tool_name": "web_search", "tool_args": {"query": "data"}, "depends_on": []}' \
  | jq -r .task_id)

# Add parallel tasks (depend on A)
TASK_B=$(curl -s -X POST http://127.0.0.1:8765/workflows/$WF/tasks \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"B\", \"tool_name\": \"fetch_url\", \"tool_args\": {}, \"depends_on\": [\"$TASK_A\"]}" \
  | jq -r .task_id)

TASK_C=$(curl -s -X POST http://127.0.0.1:8765/workflows/$WF/tasks \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"C\", \"tool_name\": \"fetch_url\", \"tool_args\": {}, \"depends_on\": [\"$TASK_A\"]}" \
  | jq -r .task_id)

# Add terminal task (depends on both B and C)
TASK_D=$(curl -s -X POST http://127.0.0.1:8765/workflows/$WF/tasks \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"D\", \"tool_name\": \"deep_research\", \"tool_args\": {}, \"depends_on\": [\"$TASK_B\", \"$TASK_C\"]}" \
  | jq -r .task_id)

# Execute - A runs first, then B & C in parallel, then D
curl -X POST http://127.0.0.1:8765/workflows/$WF/execute
```

## Retry & Timeout Handling

### Retry Logic
- Tasks can be retried up to `max_retries` times
- Retry delay uses exponential backoff: `2^attempt` seconds
- Default: 3 retries (0, 1, 2 attempts = 4 total tries)

```http
POST /workflows/{id}/tasks

{
  "name": "Flaky Tool",
  "tool_name": "some_tool",
  "tool_args": {...},
  "max_retries": 5,           # Try up to 6 times total
  "timeout_seconds": 60       # Each attempt has 60s timeout
}
```

### Timeout Behavior
- Each task execution has an optional timeout
- If timeout exceeded, task fails (can be retried)
- Default: 30 seconds

## Database Schema

```sql
CREATE TABLE workflows (
  workflow_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,              -- draft|ready|running|completed|failed|cancelled
  tasks_json TEXT NOT NULL,           -- JSON: {task_id: task_dict}
  results_json TEXT,                  -- JSON: {task_id: result_dict}
  error TEXT,
  created_at REAL NOT NULL,
  started_at REAL,
  completed_at REAL
)
```

Stored in: `~/.bucks/nexus_goals.db`

## Dependency Resolution Algorithm

Uses Kahn's topological sort with batching:

1. Find all tasks with no dependencies (in-degree = 0)
2. These form the first execution batch (run in parallel)
3. Remove executed tasks from graph
4. Repeat until all tasks complete or failure occurs

**Example batching:**
```
A (no deps)
├─ B (depends on A)
│  └─ D (depends on B)
└─ C (depends on A)
   └─ D (depends on C)

Batches:
1. [A]        # Run: A
2. [B, C]     # Run: B and C in parallel
3. [D]        # Run: D
```

## Integration with Bucks Tools

Any tool in the registry can be used in a workflow:

- File operations: `read_file`, `write_file`, `list_directory`
- Web: `web_search`, `fetch_url`, `deep_research`
- IPFS: `ipfs_upload_text`, `ipfs_cat_text`, `dweb_publish`
- Calendar: `calendar_add`, `calendar_list`
- Commerce: `product_search`, `track_order`
- ... and 25+ more tools

## Tool Executor Integration

By default, workflows execute through the tool registry. Custom executors can be provided:

```python
from task_orchestrator import TaskOrchestrator

async def my_executor(tool_name: str, tool_args: dict) -> Any:
    """Custom tool executor."""
    if tool_name == "my_tool":
        return await my_tool(**tool_args)
    raise ValueError(f"Unknown tool: {tool_name}")

orchestrator = TaskOrchestrator(tool_executor=my_executor)
```

## Error Handling

### Task Failure Scenarios

1. **Tool Not Found** - Task marked failed immediately
2. **Invalid Arguments** - Task marked failed immediately
3. **Timeout** - Task retried (if max_retries > 0)
4. **Exception** - Task retried with exponential backoff
5. **Max Retries Exceeded** - Task marked failed, workflow stops

### Workflow Failure

When any task fails and `max_retries` is exhausted:
- Remaining tasks marked as cancelled
- Workflow status set to "failed"
- Error message stored in workflow.error

## Performance Characteristics

| Operation | Complexity |
|-----------|-----------|
| Create workflow | O(1) |
| Add task | O(1) |
| Execute workflow | O(N) where N = number of tasks |
| Topological sort | O(N + E) where E = dependencies |
| Parallel batch size | Up to N (limited by dependencies) |

## Persistence & Recovery

Workflows are persisted to SQLite after:
- Creation
- Task addition
- Task completion
- Workflow completion/failure

Recover workflows across restarts:
```python
orchestrator.load_workflow(workflow_id)
```

## Monitoring & Observability

Track workflow progress:

```bash
# Get overall status
curl http://127.0.0.1:8765/workflows/abc123

# Output:
{
  "workflow_id": "abc123",
  "status": "running",
  "progress": {
    "total": 10,
    "completed": 3,
    "failed": 0,
    "pending": 7,
    "percent": 30.0
  }
}
```

## Limitations & Future Work

- ❌ Conditional branches (if/else based on results) - not yet supported
- ❌ Loop workflows (repeat tasks) - not yet supported
- ❌ Task resource limits (memory, CPU) - not yet enforced
- ❌ Task priority/weighting - all tasks treated equally
- ❌ Distributed execution - all tasks run on local machine
- ✅ Retry with backoff - implemented
- ✅ Parallel execution - implemented
- ✅ Dependency resolution - implemented
- ✅ Result aggregation - implemented

## See Also

- [Task Orchestrator Code](agent/task_orchestrator.py)
- [Soul Engine Endpoints](agent/soul_engine.py) (lines 1669-1750)
- [Registry Tools](agent/tools/registry.py) (workflow tools)
- [MCP Server](agent/mcp_server.py) - Exposes workflows via MCP
