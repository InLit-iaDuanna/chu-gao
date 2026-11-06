import asyncio
import json
from pathlib import Path
import sys
import tempfile
import unittest

import app as runtime


class ProcessStateTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="research-process-check-")
        self.previous_root = runtime.ROOT
        runtime.ROOT = Path(self.temporary.name)

    async def asyncTearDown(self):
        runtime.ROOT = self.previous_root
        self.temporary.cleanup()

    async def consume(self, script, status="running"):
        run_id = "synthetic-process"
        folder = runtime.run_dir(run_id)
        folder.mkdir()
        runtime.write_state(folder, {"status": status, "seq": 0, "retentionDays": 30})
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-c", script,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True, limit=65536,
        )
        runtime.processes[run_id] = process
        try:
            await asyncio.wait_for(runtime.consume_process(run_id, process), timeout=15)
            self.assertNotIn(run_id, runtime.processes)
            return json.loads((folder / "state.json").read_text()), folder
        finally:
            if process.returncode is None:
                await runtime.stop_process(process)

    async def test_large_framework_output_and_event_complete(self):
        state, folder = await self.consume(
            "import json; print('framework log ' + 'x' * (3 * 1024 * 1024)); "
            "print(json.dumps({'type':'text','data':{'delta':'x' * (3 * 1024 * 1024)}})); "
            "print(json.dumps({'type':'result','data':{'text':'synthetic result'}}))"
        )
        self.assertEqual(state["status"], "completed")
        self.assertEqual(state["seq"], 2)
        self.assertEqual(state["result"]["text"], "synthetic result")
        self.assertTrue((folder / "events.jsonl").exists())

    async def test_oversized_event_fails_and_preserves_previous_events(self):
        state, folder = await self.consume(
            "import json,time; print(json.dumps({'type':'activity','data':{'message':'saved'}}),flush=True); "
            "print('x' * (9 * 1024 * 1024),flush=True); time.sleep(60)"
        )
        self.assertEqual(state["status"], "failed")
        self.assertEqual(state["seq"], 1)
        self.assertIn("进度读取失败", state["error"])
        self.assertIn("saved", (folder / "events.jsonl").read_text())

    async def test_failed_process_is_not_left_running(self):
        state, _ = await self.consume("raise SystemExit(1)")
        self.assertEqual(state["status"], "failed")

    async def test_completion_does_not_override_cancellation(self):
        state, _ = await self.consume(
            "import json; print(json.dumps({'type':'result','data':{}}))", status="cancelled"
        )
        self.assertEqual(state["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()
