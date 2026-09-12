import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import * as weave from "weave";

async function main() {
  if (!process.env.WANDB_API_KEY?.trim()) {
    throw new Error("Set WANDB_API_KEY in .env before running this check.");
  }

  const project = process.env.WEAVE_PROJECT?.trim() || "beyond-green";
  if (!/^[\w-]+(?:\/[\w-]+)?$/.test(project)) {
    throw new Error("WEAVE_PROJECT must be project or team/project.");
  }

  const client = await weave.init(project);
  const probe = weave.op(
    async function connectionCheck(checkId: string) {
      return { checkId, status: "ok", synthetic: true };
    },
    { name: "beyond_green_connection_check" },
  );

  const checkId = randomUUID();
  const [, call] = await probe.invoke(checkId);
  await client.flush();

  // Read the exact call back: a successful local invocation alone does not
  // establish that the trace reached W&B. Allow for indexing delay.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await delay(1000);
    const calls = await client.getCalls({ filter: { call_ids: [call.id] } });
    const saved = calls[0];
    const output: unknown = saved?.output;
    if (saved?.ended_at && !saved.exception && output !== null &&
        typeof output === "object" && "checkId" in output && output.checkId === checkId) {
      console.log("W&B Weave connected. Synthetic trace uploaded and read back.");
      console.log(`https://wandb.ai/${client.projectId}/r/call/${call.id}`);
      return;
    }
  }
  throw new Error("The trace could not be read back. Check W&B and retry.");
}

const timeout = setTimeout(() => {
  console.error("W&B connection check timed out. Check your network and credentials.");
  process.exit(1);
}, 45_000);
timeout.unref();

try {
  await main();
} catch (error) {
  // Do not dump SDK errors: HTTP request details may contain credentials.
  const message = error instanceof Error ? error.message : "Unknown error";
  const safeMessages = [
    "Set WANDB_API_KEY in .env before running this check.",
    "WEAVE_PROJECT must be project or team/project.",
    "The trace could not be read back. Check W&B and retry.",
  ];
  console.error(safeMessages.includes(message)
    ? message
    : "W&B connection failed. Check the API key, team/project access, and network.");
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
