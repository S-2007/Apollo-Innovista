"""Live progress from inside graph nodes (e.g. a section's text while the LLM is still writing it).

Graph updates reach the browser only when a node FINISHES. For things worth showing earlier, a
node calls publish(type, data); api.py registers a sink per run that turns it into an SSE event.
The run is found from LangGraph's own config (api.py uses the run id as thread_id), the same way
metering.py attributes calls. Outside a registered run (tests, the CLI) publish() does nothing.
"""

import threading
from typing import Callable

_lock = threading.Lock()
_sinks: dict[str, Callable[[str, dict], None]] = {}


def register(run_id: str, sink: Callable[[str, dict], None]) -> None:
    with _lock:
        _sinks[run_id] = sink


def unregister(run_id: str) -> None:
    with _lock:
        _sinks.pop(run_id, None)


def publish(type_: str, data: dict) -> None:
    try:
        from langgraph.config import get_config

        run_id = (get_config().get("configurable") or {}).get("thread_id")
    except Exception:  # not inside a graph node
        return
    with _lock:
        sink = _sinks.get(str(run_id))
    if sink:
        sink(type_, data)
