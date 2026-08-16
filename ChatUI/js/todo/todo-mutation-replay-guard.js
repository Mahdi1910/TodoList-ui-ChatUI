/**
 * todo-mutation-replay-guard.js - Short-lived duplicate/timeout protection for Todo mutations.
 * This deliberately performs structural canonicalization only. Todo remains the owner of business normalization.
 */

const STORAGE_KEY = 'chatui.todoMutationReplay.v1';
const RECEIPT_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_SETTLED = 100;
const MUTATION_TOOLS = new Set([
  'todo_create_tasks', 'todo_update_tasks', 'todo_delete_tasks',
  'todo_create_projects', 'todo_update_projects', 'todo_delete_projects',
  'todo_create_tags', 'todo_update_tags', 'todo_delete_tags',
  'todo_update_workspace'
]);

function safeStorage() {
  try { return globalThis.sessionStorage || null; } catch (_) { return null; }
}

function randomToken() {
  if (globalThis.crypto?.randomUUID) return `todo-confirm:${crypto.randomUUID()}`;
  return `todo-confirm:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}

function fingerprintArgs(args = {}) {
  const copy = { ...(args && typeof args === 'object' ? args : {}) };
  delete copy.duplicateConfirmationToken;
  return canonical(copy);
}

export function todoMutationFingerprint(functionName, args = {}) {
  return JSON.stringify({ functionName: String(functionName || ''), args: fingerprintArgs(args) });
}

function compactResult(result) {
  const data = result?.data || {};
  const meta = result?.meta || {};
  const ids = [];
  const collect = value => {
    if (!value) return;
    if (typeof value === 'string') ids.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (/id$/i.test(key) || /ids$/i.test(key)) collect(item);
      }
    }
  };
  collect(data);
  return {
    ok: result?.ok !== false,
    code: result?.error?.code || null,
    message: String(result?.overview?.message || result?.error?.message || '').slice(0, 500),
    affectedCount: Math.max(0, Number(meta.affectedCount) || 0),
    affectedIds: [...new Set(ids)].slice(0, 50)
  };
}

function loadReceipts() {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter(item => item && typeof item === 'object' && typeof item.fingerprint === 'string')
      .map(item => item.status === 'pending' ? { ...item, status: 'unknown' } : item)
      .filter(item => now - (Number(item.timestamp) || 0) <= RECEIPT_TTL_MS);
  } catch (_) {
    return [];
  }
}

let receipts = loadReceipts();

function prune() {
  const now = Date.now();
  receipts = receipts.filter(item => now - (Number(item.timestamp) || 0) <= RECEIPT_TTL_MS);
  const unsettled = receipts.filter(item => item.status === 'pending');
  const settled = receipts.filter(item => item.status !== 'pending')
    .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
    .slice(0, MAX_SETTLED);
  receipts = [...unsettled, ...settled];
}

function persist() {
  prune();
  const storage = safeStorage();
  if (!storage) return;
  try { storage.setItem(STORAGE_KEY, JSON.stringify(receipts)); } catch (_) {}
}

function newestByFingerprint(fp) {
  prune();
  return receipts
    .filter(item => item.fingerprint === fp)
    .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))[0] || null;
}

function findByRequestId(requestId) {
  return receipts.find(item => item.requestId === requestId) || null;
}

function replaceReceipt(next) {
  receipts = receipts.filter(item => item.requestId !== next.requestId);
  receipts.push(next);
  persist();
  return next;
}

function blocked(code, message, receipt, extra = {}) {
  return {
    execute: false,
    result: {
      ok: false,
      overview: { message, affectedCount: 0 },
      error: {
        code,
        message,
        details: {
          previous: receipt?.compact || null,
          previousRequestId: receipt?.requestId || null,
          ...extra
        }
      },
      meta: { mutationOccurred: false }
    }
  };
}

export const TodoMutationReplayGuard = {
  isMutationTool(name) {
    return MUTATION_TOOLS.has(String(name || ''));
  },

  beforeMutation({ functionName, args = {}, userTurnId = '', generationMode = 'normal' } = {}) {
    const fp = todoMutationFingerprint(functionName, args);
    const suppliedToken = typeof args?.duplicateConfirmationToken === 'string' ? args.duplicateConfirmationToken : '';
    const previous = newestByFingerprint(fp);

    if (!previous || previous.status === 'failed_no_mutation') {
      return { execute: true, fingerprint: fp, confirmedDuplicate: false };
    }

    if (previous.status === 'partial_committed') {
      return blocked(
        'PARTIAL_REPLAY_BLOCKED',
        'This exact Todo request already changed some data. Read current Todo state and retry only the failed or unattempted remainder.',
        previous
      );
    }

    if (previous.status === 'pending' || previous.status === 'unknown') {
      return blocked(
        'MUTATION_OUTCOME_UNKNOWN',
        'The outcome of this exact earlier Todo mutation is not known yet. Read/reconcile Todo state before trying another mutation.',
        previous
      );
    }

    if (previous.status === 'success') {
      const confirmation = previous.confirmation || null;
      const tokenValid = Boolean(
        suppliedToken && confirmation &&
        suppliedToken === confirmation.token &&
        Date.now() <= Number(confirmation.expiresAt || 0) &&
        userTurnId && userTurnId !== confirmation.warningUserTurnId &&
        generationMode !== 'regenerate' &&
        !confirmation.consumed
      );

      if (tokenValid) {
        previous.confirmation = { ...confirmation, consumed: true };
        previous.timestamp = Date.now();
        persist();
        return { execute: true, fingerprint: fp, confirmedDuplicate: true };
      }

      const token = confirmation && !confirmation.consumed && Date.now() <= Number(confirmation.expiresAt || 0)
        ? confirmation.token
        : randomToken();
      previous.confirmation = {
        token,
        warningUserTurnId: String(userTurnId || ''),
        issuedAt: Date.now(),
        expiresAt: Date.now() + TOKEN_TTL_MS,
        consumed: false
      };
      previous.timestamp = Date.now();
      persist();
      return blocked(
        'DUPLICATE_CONFIRMATION_REQUIRED',
        'This exact Todo mutation was already completed. Ask the user whether they really want to repeat it and create the duplicate/effect again.',
        previous,
        { duplicateConfirmationToken: token, tokenExpiresInSeconds: Math.floor(TOKEN_TTL_MS / 1000) }
      );
    }

    return { execute: true, fingerprint: fp, confirmedDuplicate: false };
  },

  markPending({ fingerprint: fp, requestId, userTurnId = '', generationMode = 'normal', generationAttemptId = '' } = {}) {
    const receipt = {
      fingerprint: fp,
      requestId: String(requestId || ''),
      userTurnId: String(userTurnId || ''),
      generationMode: String(generationMode || 'normal'),
      generationAttemptId: String(generationAttemptId || ''),
      status: 'pending',
      timestamp: Date.now(),
      compact: null,
      confirmation: null
    };
    return replaceReceipt(receipt);
  },

  recordResult(requestId, result) {
    const receipt = findByRequestId(String(requestId || ''));
    if (!receipt) return null;
    const mutationOccurred = Boolean(result?.meta?.mutationOccurred);
    const partial = ['PARTIAL_FAILURE', 'PARTIAL_MUTATION'].includes(result?.error?.code);
    let status = 'failed_no_mutation';
    if (partial && mutationOccurred) status = 'partial_committed';
    else if (result?.ok === true && mutationOccurred) status = 'success';
    else if (mutationOccurred) status = 'partial_committed';
    receipt.status = status;
    receipt.timestamp = Date.now();
    receipt.compact = compactResult(result);
    receipt.confirmation = null;
    persist();
    return receipt;
  },

  markUnknown(requestId) {
    const receipt = findByRequestId(String(requestId || ''));
    if (!receipt) return null;
    receipt.status = 'unknown';
    receipt.timestamp = Date.now();
    persist();
    return receipt;
  },

  markFailedNoMutation(requestId, result = null) {
    const receipt = findByRequestId(String(requestId || ''));
    if (!receipt) return null;
    receipt.status = 'failed_no_mutation';
    receipt.timestamp = Date.now();
    receipt.compact = compactResult(result);
    persist();
    return receipt;
  },

  recordLateResult(requestId, result) {
    return this.recordResult(requestId, result);
  },

  getPendingConfirmationHints() {
    prune();
    const now = Date.now();
    return receipts
      .filter(item => item.status === 'success' && item.confirmation && !item.confirmation.consumed && now <= Number(item.confirmation.expiresAt || 0))
      .map(item => ({
        fingerprint: item.fingerprint,
        functionName: (() => { try { return JSON.parse(item.fingerprint).functionName || ''; } catch (_) { return ''; } })(),
        token: item.confirmation.token,
        warningUserTurnId: item.confirmation.warningUserTurnId,
        previous: item.compact || null
      }));
  },

  _debugReceipts() {
    return receipts.map(item => ({ ...item }));
  }
};
