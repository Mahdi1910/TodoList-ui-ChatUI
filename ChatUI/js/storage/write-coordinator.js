/**
 * write-coordinator.js - Serialize core ChatUI persistence mutations.
 *
 * Core chat/project/settings writes share this queue so a fallback full
 * reconciliation can never race a newer targeted mutation and overwrite it.
 * Read Aloud cache and Workspace stores remain independent by design.
 */

let coreWriteQueue = Promise.resolve();

export function enqueueCoreWrite(operation) {
  if (typeof operation !== 'function') {
    return Promise.reject(new TypeError('Persistence operation must be a function.'));
  }

  const queued = coreWriteQueue.then(() => operation());
  coreWriteQueue = queued.catch(() => undefined);
  return queued;
}

export function waitForCoreWrites() {
  return coreWriteQueue;
}
