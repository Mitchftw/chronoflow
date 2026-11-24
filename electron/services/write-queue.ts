let writeQueue: Promise<void> = Promise.resolve();

/**
 * Serialize edits from Electron and MCP, including in-memory timer transitions.
 */
export function enqueueWrite<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const run = writeQueue.then(operation);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
