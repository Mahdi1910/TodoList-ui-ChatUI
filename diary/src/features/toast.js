export function showToast(message, actionText = null, onAction = null, duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    
    const textSpan = document.createElement('span');
    textSpan.className = 'toast-message';
    textSpan.innerHTML = message;
    toast.appendChild(textSpan);

    if (actionText && onAction) {
        const actionBtn = document.createElement('button');
        actionBtn.className = 'toast-action';
        actionBtn.textContent = actionText;
        actionBtn.addEventListener('click', () => {
            onAction();
            hideToast(toast);
        });
        toast.appendChild(actionBtn);
    }

    container.appendChild(toast);

    const timeoutId = setTimeout(() => {
        hideToast(toast);
    }, duration);

    toast.dataset.timeoutId = timeoutId;
}

function hideToast(toast) {
    if (toast.dataset.timeoutId) {
        clearTimeout(toast.dataset.timeoutId);
    }
    toast.classList.add('hiding');
    toast.addEventListener('animationend', () => {
        toast.remove();
    });
}
