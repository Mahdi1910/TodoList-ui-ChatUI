function appendSafeToastMessage(target, message) {
    const template = document.createElement('template');
    template.innerHTML = String(message ?? '');

    const appendNode = node => {
        if (node.nodeType === Node.TEXT_NODE) {
            target.appendChild(document.createTextNode(node.textContent || ''));
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.tagName === 'I') {
            const icon = document.createElement('i');
            const classes = [...node.classList].filter(name => name === 'fa-solid' || name === 'fa-regular' || name === 'fa-brands' || /^fa-[a-z0-9-]+$/i.test(name));
            if (classes.length) icon.className = classes.join(' ');
            const color = node.style?.color || '';
            if (/^(#[0-9a-f]{3,8}|rgb\([^)]*\)|rgba\([^)]*\)|var\(--[a-z0-9-]+\))$/i.test(color)) icon.style.color = color;
            target.appendChild(icon);
            return;
        }
        target.appendChild(document.createTextNode(node.textContent || ''));
    };

    [...template.content.childNodes].forEach(appendNode);
}

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
    appendSafeToastMessage(textSpan, message);
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
    const timeoutId = setTimeout(() => hideToast(toast), duration);
    toast.dataset.timeoutId = timeoutId;
}

function hideToast(toast) {
    if (toast.dataset.timeoutId) clearTimeout(toast.dataset.timeoutId);
    toast.classList.add('hiding');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
}
