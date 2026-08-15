const BOOTSTRAP_MESSAGES = {
  MODULE_LOAD: 'A required application module could not be loaded.',
  INTEGRATION: 'Application modules loaded, but one integration is incomplete.',
  DATABASE_OPEN: 'TodoListDB could not be opened. Existing data was not cleared.',
  DATABASE_REPAIR: 'Stored data could not be repaired safely. Existing data was not cleared.',
  HYDRATION: 'Stored data could not be loaded into the application.',
  UI_INIT: 'Data loaded, but the interface could not finish starting.'
};

const STORAGE_STAGES = new Set(['DATABASE_OPEN', 'DATABASE_REPAIR', 'HYDRATION']);
let storageErrorReporter = null;

function showBootstrapBanner(message) {
  let banner = document.getElementById('bootstrap-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'bootstrap-error-banner';
    Object.assign(banner.style, {
      position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)', zIndex: '9999',
      maxWidth: 'min(560px, calc(100vw - 24px))', padding: '10px 14px', borderRadius: '10px',
      background: '#171717', color: '#fff', border: '1px solid #444', boxShadow: '0 8px 30px rgba(0,0,0,.35)',
      fontSize: '13px'
    });
    document.body.appendChild(banner);
  }
  banner.textContent = message;
}
function reportBootstrapError(stage, error) {
  const message = BOOTSTRAP_MESSAGES[stage] || 'The application could not finish starting.';
  console.error(`[${stage}] ${message}`, error);
  if (STORAGE_STAGES.has(stage) && typeof storageErrorReporter === 'function') {
    storageErrorReporter(message, error);
    return;
  }
  showBootstrapBanner(message);
}

async function runStage(stage, work) {
  try {
    return await work();
  } catch (error) {
    reportBootstrapError(stage, error);
    throw error;
  }
}

async function bootstrap() {
  let application;
  try {
    application = await runStage('MODULE_LOAD', () => import('./app-main.js'));
    await application.startApplication({
      runStage,
      setStorageErrorReporter(reporter) { storageErrorReporter = reporter; }
    });
  } catch (_) {
    return;
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
