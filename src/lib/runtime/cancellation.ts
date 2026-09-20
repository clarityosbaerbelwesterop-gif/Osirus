const activeControllers = new Map<string, AbortController>();

export function registerRunController(
  runId: string,
  controller: AbortController,
) {
  activeControllers.set(runId, controller);
  return () => {
    if (activeControllers.get(runId) === controller)
      activeControllers.delete(runId);
  };
}

export function abortLocalRun(runId: string, reason = "cancel_requested") {
  const controller = activeControllers.get(runId);
  if (!controller) return false;
  controller.abort(new Error(reason));
  return true;
}

export function isRunActiveLocally(runId: string) {
  return activeControllers.has(runId);
}
