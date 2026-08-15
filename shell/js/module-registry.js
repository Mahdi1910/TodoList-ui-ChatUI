const modulePromises = new Map();

const MODULE_LOADERS = Object.freeze({
  todo: () => import('../../TodoList-ui/js/module.js'),
  chat: () => import('../../ChatUI/js/module.js')
});

export async function loadApplicationModule(appId) {
  const loader = MODULE_LOADERS[appId];
  if (!loader) throw new Error(`Unknown application module: ${appId}`);
  if (!modulePromises.has(appId)) modulePromises.set(appId, loader());
  const moduleNamespace = await modulePromises.get(appId);
  if (typeof moduleNamespace.mount !== 'function') {
    modulePromises.delete(appId);
    throw new Error(`${appId} module does not expose mount(context).`);
  }
  return moduleNamespace;
}

export function resetModuleImport(appId) {
  // ES modules themselves remain browser-cached. This only allows a failed
  // dynamic import to be retried on a later hard/soft navigation attempt.
  modulePromises.delete(appId);
}
