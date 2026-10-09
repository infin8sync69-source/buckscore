"""
Task Orchestrator — Openclaw-like Workflow Engine for Bucks

Enables multi-step task execution with dependency resolution, parallel execution,
and persistent workflow tracking. Acts as Bucks' equivalent to Openclaw for
coordinating complex agentic workflows.

Features:
  • Task creation with dependencies
  • Workflow composition (sequences, parallel groups, conditional branches)
  • Dependency resolution and validation
  • Parallel task execution where possible
  • Status tracking and persistence
  • Result aggregation
  • Failure handling and retries
"""

import asyncio
import uuid
import json
import time
import logging
from enum import Enum
from typing import Any, Dict, List, Optional, Callable
from dataclasses import dataclass, asdict
from pathlib import Path
import sqlite3

log = logging.getLogger("task-orchestrator")


class TaskStatus(str, Enum):
    """Task execution status."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    WAITING = "waiting"  # Waiting for dependencies


class WorkflowStatus(str, Enum):
    """Workflow execution status."""
    DRAFT = "draft"
    READY = "ready"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class TaskResult:
    """Result of a task execution."""
    task_id: str
    status: TaskStatus
    output: Optional[Any] = None
    error: Optional[str] = None
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    duration_ms: Optional[float] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Task:
    """A single task in a workflow."""
    task_id: str
    name: str
    description: Optional[str] = None
    tool_name: Optional[str] = None
    tool_args: Optional[Dict[str, Any]] = None
    depends_on: Optional[List[str]] = None
    retry_count: int = 0
    max_retries: int = 3
    timeout_seconds: Optional[int] = None
    status: TaskStatus = TaskStatus.PENDING
    result: Optional[TaskResult] = None

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "name": self.name,
            "description": self.description,
            "tool_name": self.tool_name,
            "tool_args": self.tool_args,
            "depends_on": self.depends_on or [],
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
            "timeout_seconds": self.timeout_seconds,
            "status": self.status.value,
            "result": self.result.to_dict() if self.result else None
        }


@dataclass
class Workflow:
    """A workflow is a collection of tasks with dependencies."""
    workflow_id: str
    name: str
    description: Optional[str] = None
    tasks: Optional[Dict[str, Task]] = None
    status: WorkflowStatus = WorkflowStatus.DRAFT
    created_at: float = 0
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    results: Optional[Dict[str, TaskResult]] = None
    error: Optional[str] = None

    def __post_init__(self):
        if self.tasks is None:
            self.tasks = {}
        if self.results is None:
            self.results = {}
        if self.created_at == 0:
            self.created_at = time.time()

    def to_dict(self) -> dict:
        return {
            "workflow_id": self.workflow_id,
            "name": self.name,
            "description": self.description,
            "tasks": {tid: t.to_dict() for tid, t in (self.tasks or {}).items()},
            "status": self.status.value,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "results": {tid: r.to_dict() for tid, r in (self.results or {}).items()},
            "error": self.error
        }


class TaskOrchestrator:
    """Orchestrates task execution with dependency resolution."""

    def __init__(self, db_path: Optional[Path] = None, tool_executor: Optional[Callable] = None):
        """Initialize the task orchestrator.

        Args:
            db_path: Path to SQLite database for persistence
            tool_executor: Async function to execute tools: async (tool_name, args) -> result
        """
        self.db_path = db_path or Path.home() / ".bucks" / "nexus_goals.db"
        self.tool_executor = tool_executor or self._default_executor
        self.workflows: Dict[str, Workflow] = {}
        self._init_db()

    def _init_db(self):
        """Initialize SQLite database schema."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS workflows (
                workflow_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL,
                tasks_json TEXT NOT NULL,
                results_json TEXT,
                error TEXT,
                created_at REAL NOT NULL,
                started_at REAL,
                completed_at REAL
            )
        """)
        conn.commit()
        conn.close()

    def create_workflow(self, name: str, description: Optional[str] = None) -> Workflow:
        """Create a new workflow.

        Args:
            name: Workflow name
            description: Optional description

        Returns:
            New Workflow instance
        """
        workflow = Workflow(
            workflow_id=str(uuid.uuid4()),
            name=name,
            description=description
        )
        self.workflows[workflow.workflow_id] = workflow
        self._save_workflow(workflow)
        log.info(f"Created workflow: {workflow.workflow_id} ({name})")
        return workflow

    def add_task(
        self,
        workflow_id: str,
        name: str,
        tool_name: str,
        tool_args: Dict[str, Any],
        depends_on: Optional[List[str]] = None,
        description: Optional[str] = None,
        max_retries: int = 3,
        timeout_seconds: Optional[int] = None
    ) -> Task:
        """Add a task to a workflow.

        Args:
            workflow_id: ID of the workflow
            name: Task name
            tool_name: Name of the tool to execute
            tool_args: Arguments for the tool
            depends_on: List of task IDs this task depends on
            description: Optional description
            max_retries: Maximum retry attempts (default 3)
            timeout_seconds: Task timeout in seconds

        Returns:
            New Task instance
        """
        workflow = self._get_or_load(workflow_id)
        if not workflow:
            raise ValueError(f"Workflow not found: {workflow_id}")

        task = Task(
            task_id=str(uuid.uuid4()),
            name=name,
            description=description,
            tool_name=tool_name,
            tool_args=tool_args,
            depends_on=depends_on or [],
            max_retries=max_retries,
            timeout_seconds=timeout_seconds
        )

        # Validate dependencies
        for dep_id in task.depends_on:
            if dep_id not in workflow.tasks:
                raise ValueError(f"Dependency not found in workflow: {dep_id}")

        workflow.tasks[task.task_id] = task
        self._save_workflow(workflow)
        log.info(f"Added task to workflow {workflow_id}: {task.task_id} ({name})")
        return task

    async def execute_workflow(self, workflow_id: str) -> Workflow:
        """Execute a workflow (all tasks with dependency resolution).

        Executes tasks in parallel where possible, respecting dependencies.

        Args:
            workflow_id: ID of the workflow to execute

        Returns:
            Completed workflow with results
        """
        workflow = self._get_or_load(workflow_id)
        if not workflow:
            raise ValueError(f"Workflow not found: {workflow_id}")

        workflow.status = WorkflowStatus.RUNNING
        workflow.started_at = time.time()
        self._save_workflow(workflow)

        try:
            # Build execution order
            task_order = self._topological_sort(workflow)

            # Execute in dependency order
            for batch in task_order:
                # Tasks in the same batch can run in parallel
                tasks_to_run = [workflow.tasks[tid] for tid in batch]
                results = await asyncio.gather(
                    *[self._execute_task(workflow, task) for task in tasks_to_run],
                    return_exceptions=True
                )

                # Store results
                for task, result in zip(tasks_to_run, results):
                    if isinstance(result, Exception):
                        task.status = TaskStatus.FAILED
                        task.result = TaskResult(
                            task_id=task.task_id,
                            status=TaskStatus.FAILED,
                            error=str(result),
                            completed_at=time.time()
                        )
                        log.error(f"Task {task.task_id} failed: {result}")
                    else:
                        task.result = result
                        workflow.results[task.task_id] = result

                # Check for failures
                if any(t.status == TaskStatus.FAILED for t in tasks_to_run):
                    workflow.status = WorkflowStatus.FAILED
                    workflow.error = "One or more tasks failed"
                    self._save_workflow(workflow)
                    return workflow

            workflow.status = WorkflowStatus.COMPLETED
            workflow.completed_at = time.time()
            self._save_workflow(workflow)
            log.info(f"Workflow {workflow_id} completed successfully")
            return workflow

        except Exception as e:
            workflow.status = WorkflowStatus.FAILED
            workflow.error = str(e)
            workflow.completed_at = time.time()
            self._save_workflow(workflow)
            log.error(f"Workflow {workflow_id} failed: {e}")
            return workflow

    async def _execute_task(self, workflow: Workflow, task: Task) -> TaskResult:
        """Execute a single task with retry logic.

        Args:
            workflow: Parent workflow
            task: Task to execute

        Returns:
            TaskResult with execution details
        """
        task.status = TaskStatus.RUNNING
        start_time = time.time()

        for attempt in range(task.max_retries + 1):
            try:
                log.info(f"Executing task {task.task_id} ({task.name}) - attempt {attempt + 1}")

                # Execute tool with timeout
                timeout = task.timeout_seconds or 30
                result = await asyncio.wait_for(
                    self.tool_executor(task.tool_name, task.tool_args),
                    timeout=timeout
                )

                duration_ms = (time.time() - start_time) * 1000
                task.status = TaskStatus.COMPLETED
                task.result = TaskResult(
                    task_id=task.task_id,
                    status=TaskStatus.COMPLETED,
                    output=result,
                    started_at=start_time,
                    completed_at=time.time(),
                    duration_ms=duration_ms
                )
                log.info(f"Task {task.task_id} completed in {duration_ms:.0f}ms")
                return task.result

            except asyncio.TimeoutError:
                error = f"Task timeout after {task.timeout_seconds}s"
                log.warning(f"Task {task.task_id}: {error} (attempt {attempt + 1})")
                if attempt >= task.max_retries:
                    task.status = TaskStatus.FAILED
                    return TaskResult(
                        task_id=task.task_id,
                        status=TaskStatus.FAILED,
                        error=error,
                        completed_at=time.time()
                    )

            except Exception as e:
                error = str(e)
                log.warning(f"Task {task.task_id} error: {error} (attempt {attempt + 1})")
                if attempt >= task.max_retries:
                    task.status = TaskStatus.FAILED
                    return TaskResult(
                        task_id=task.task_id,
                        status=TaskStatus.FAILED,
                        error=error,
                        completed_at=time.time()
                    )

            # Wait before retry
            if attempt < task.max_retries:
                await asyncio.sleep(2 ** attempt)

    def _topological_sort(self, workflow: Workflow) -> List[List[str]]:
        """Topologically sort tasks respecting dependencies.

        Returns list of task ID batches where each batch can execute in parallel.

        Args:
            workflow: Workflow to sort

        Returns:
            List of task ID batches (each batch can run in parallel)
        """
        # Build dependency graph
        in_degree = {tid: len(task.depends_on) for tid, task in workflow.tasks.items()}
        graph = {tid: [] for tid in workflow.tasks}

        for tid, task in workflow.tasks.items():
            for dep_id in task.depends_on:
                graph[dep_id].append(tid)

        # Kahn's algorithm for topological sort with batching
        queue = [tid for tid in workflow.tasks if in_degree[tid] == 0]
        batches = []

        while queue:
            batches.append(queue[:])  # Current batch
            next_queue = []

            for node in queue:
                for neighbor in graph[node]:
                    in_degree[neighbor] -= 1
                    if in_degree[neighbor] == 0:
                        next_queue.append(neighbor)

            queue = next_queue

        # Kahn's algorithm silently drops any task caught in a dependency
        # cycle: it never reaches in-degree 0, so it never enters a batch. The
        # workflow would then finish "completed" having skipped those tasks.
        scheduled = sum(len(b) for b in batches)
        if scheduled != len(workflow.tasks):
            stuck = [tid for tid in workflow.tasks
                     if not any(tid in b for b in batches)]
            names = ", ".join(
                f"{workflow.tasks[t].name} ({t[:8]})" for t in stuck
            )
            raise ValueError(f"Dependency cycle — unreachable tasks: {names}")

        return batches

    def _save_workflow(self, workflow: Workflow):
        """Persist workflow to database."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                """
                INSERT OR REPLACE INTO workflows
                (workflow_id, name, description, status, tasks_json, results_json, error, created_at, started_at, completed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    workflow.workflow_id,
                    workflow.name,
                    workflow.description,
                    workflow.status.value,
                    json.dumps({tid: t.to_dict() for tid, t in (workflow.tasks or {}).items()}),
                    json.dumps({tid: r.to_dict() for tid, r in (workflow.results or {}).items()}),
                    workflow.error,
                    workflow.created_at,
                    workflow.started_at,
                    workflow.completed_at
                )
            )
            conn.commit()
        finally:
            conn.close()

    def load_workflow(self, workflow_id: str) -> Optional[Workflow]:
        """Load a workflow from database."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                "SELECT name, description, status, tasks_json, results_json, error, created_at, started_at, completed_at FROM workflows WHERE workflow_id = ?",
                (workflow_id,)
            )
            row = cursor.fetchone()
            if not row:
                return None

            name, desc, status, tasks_json, results_json, error, created_at, started_at, completed_at = row

            # Reconstruct workflow
            workflow = Workflow(
                workflow_id=workflow_id,
                name=name,
                description=desc,
                status=WorkflowStatus(status),
                created_at=created_at,
                started_at=started_at,
                completed_at=completed_at,
                error=error
            )

            # Reconstruct tasks
            tasks_data = json.loads(tasks_json or "{}")
            workflow.tasks = {}
            for tid, task_dict in tasks_data.items():
                task = Task(
                    task_id=tid,
                    name=task_dict["name"],
                    description=task_dict.get("description"),
                    tool_name=task_dict.get("tool_name"),
                    tool_args=task_dict.get("tool_args"),
                    depends_on=task_dict.get("depends_on", []),
                    retry_count=task_dict.get("retry_count", 0),
                    max_retries=task_dict.get("max_retries", 3),
                    timeout_seconds=task_dict.get("timeout_seconds"),
                    status=TaskStatus(task_dict.get("status", "pending")),
                    result=TaskResult(**task_dict["result"]) if task_dict.get("result") else None
                )
                workflow.tasks[tid] = task

            # Reconstruct results
            results_data = json.loads(results_json or "{}")
            workflow.results = {rid: TaskResult(**r) for rid, r in results_data.items()}

            self.workflows[workflow_id] = workflow
            return workflow

        finally:
            conn.close()

    async def _default_executor(self, tool_name: str, tool_args: Dict[str, Any]) -> Any:
        """Default tool executor (placeholder)."""
        log.warning(f"No tool executor configured; would execute {tool_name} with {tool_args}")
        return {"status": "mock", "message": "Configure a real tool executor"}

    def _get_or_load(self, workflow_id: str) -> Optional[Workflow]:
        """Look up a workflow in memory, falling back to the database.

        Persistence was previously write-only: every workflow was saved but
        nothing ever read it back, so after a restart — or simply from a second
        process, since Soul Engine and the MCP server are separate — every
        lookup returned "Workflow not found".
        """
        wf = self.workflows.get(workflow_id)
        if wf is not None:
            return wf
        return self.load_workflow(workflow_id)

    def list_workflows(self) -> List[Workflow]:
        """List all workflows, including ones persisted by earlier runs."""
        conn = sqlite3.connect(self.db_path)
        try:
            ids = [r[0] for r in conn.execute(
                "SELECT workflow_id FROM workflows ORDER BY created_at DESC"
            ).fetchall()]
        finally:
            conn.close()
        out = []
        for wid in ids:
            wf = self._get_or_load(wid)
            if wf:
                out.append(wf)
        return out

    def get_workflow_status(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """Get workflow status and progress."""
        workflow = self._get_or_load(workflow_id)
        if not workflow:
            return None

        total_tasks = len(workflow.tasks or {})
        completed = sum(1 for t in (workflow.tasks or {}).values() if t.status == TaskStatus.COMPLETED)
        failed = sum(1 for t in (workflow.tasks or {}).values() if t.status == TaskStatus.FAILED)

        return {
            "workflow_id": workflow_id,
            "name": workflow.name,
            "status": workflow.status.value,
            "progress": {
                "total": total_tasks,
                "completed": completed,
                "failed": failed,
                "pending": total_tasks - completed - failed,
                "percent": (completed / total_tasks * 100) if total_tasks > 0 else 0
            },
            "created_at": workflow.created_at,
            "started_at": workflow.started_at,
            "completed_at": workflow.completed_at,
            "error": workflow.error
        }
