let dialog;
let titleElement;
let messageElement;
let inputElement;
let cancelButton;
let confirmButton;
let activeRequest = null;
const requestQueue = [];

function ensureDialog() {
    if (dialog) return;

    dialog = document.createElement('div');
    dialog.className = 'modal app-dialog';
    dialog.tabIndex = -1;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'app-dialog-title');
    dialog.setAttribute('aria-describedby', 'app-dialog-message');
    dialog.setAttribute('aria-hidden', 'true');
    dialog.dataset.modalClose = '[data-dialog-cancel]';
    dialog.dataset.initialFocus = '[data-dialog-confirm]';

    const content = document.createElement('div');
    content.className = 'modal-content glass-panel app-dialog-content';

    titleElement = document.createElement('h2');
    titleElement.id = 'app-dialog-title';

    messageElement = document.createElement('p');
    messageElement.id = 'app-dialog-message';
    messageElement.className = 'app-dialog-message';

    inputElement = document.createElement('input');
    inputElement.className = 'app-dialog-input';
    inputElement.type = 'text';

    const actions = document.createElement('div');
    actions.className = 'modal-actions app-dialog-actions';

    cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-secondary';
    cancelButton.dataset.dialogCancel = '';

    confirmButton = document.createElement('button');
    confirmButton.type = 'submit';
    confirmButton.className = 'btn btn-primary';
    confirmButton.dataset.dialogConfirm = '';

    actions.append(cancelButton, confirmButton);
    content.append(titleElement, messageElement, inputElement, actions);

    const form = document.createElement('form');
    form.append(content);
    dialog.append(form);
    document.body.append(dialog);

    form.addEventListener('submit', event => {
        event.preventDefault();
        settle(activeRequest?.kind === 'prompt' ? inputElement.value : true);
    });
    cancelButton.addEventListener('click', () => settle(activeRequest?.cancelValue));
    dialog.addEventListener('click', event => {
        if (event.target === dialog) settle(activeRequest?.cancelValue);
    });
}

function settle(value) {
    if (!activeRequest) return;
    const { resolve } = activeRequest;
    activeRequest = null;
    dialog.classList.remove('active');
    resolve(value);
    requestAnimationFrame(showNext);
}

function showNext() {
    if (activeRequest || requestQueue.length === 0) return;
    ensureDialog();
    activeRequest = requestQueue.shift();
    const request = activeRequest;

    titleElement.textContent = request.title;
    messageElement.textContent = request.message;
    inputElement.hidden = request.kind !== 'prompt';
    inputElement.value = request.defaultValue || '';
    inputElement.setAttribute('aria-label', request.inputLabel || request.message);
    cancelButton.hidden = request.kind === 'alert';
    cancelButton.textContent = request.cancelLabel;
    confirmButton.textContent = request.confirmLabel;
    confirmButton.classList.toggle('btn-danger', Boolean(request.danger));
    confirmButton.classList.toggle('btn-primary', !request.danger);
    dialog.dataset.modalClose = request.kind === 'alert'
        ? '[data-dialog-confirm]'
        : '[data-dialog-cancel]';
    dialog.dataset.initialFocus = request.kind === 'prompt'
        ? '.app-dialog-input'
        : '[data-dialog-confirm]';
    dialog.classList.add('active');
}

function enqueue(request) {
    return new Promise(resolve => {
        requestQueue.push({ ...request, resolve });
        showNext();
    });
}

export function showAlert(message, { title = 'Notice', confirmLabel = 'OK' } = {}) {
    return enqueue({
        kind: 'alert',
        title,
        message: String(message || ''),
        confirmLabel,
        cancelLabel: '',
        cancelValue: true,
        danger: false,
        defaultValue: '',
        inputLabel: ''
    });
}

export function showConfirm(message, {
    title = 'Confirm',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    dismissValue = false
} = {}) {
    return enqueue({
        kind: 'confirm',
        title,
        message: String(message || ''),
        confirmLabel,
        cancelLabel,
        cancelValue: dismissValue,
        danger,
        defaultValue: '',
        inputLabel: ''
    });
}

export function showPrompt(message, {
    title = 'Enter a value',
    defaultValue = '',
    inputLabel = '',
    confirmLabel = 'Save',
    cancelLabel = 'Cancel'
} = {}) {
    return enqueue({
        kind: 'prompt',
        title,
        message: String(message || ''),
        confirmLabel,
        cancelLabel,
        cancelValue: null,
        danger: false,
        defaultValue: String(defaultValue || ''),
        inputLabel
    });
}
