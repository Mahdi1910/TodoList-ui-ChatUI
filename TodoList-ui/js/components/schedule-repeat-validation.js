export const ScheduleRepeatValidationMethods = {
  ensureRepeatValidationMessage() {
    if (this.repeatValidationMessage || !this.customRepeatForm) return;
    const message = document.createElement('div');
    message.className = 'repeat-validation-message';
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    this.customRepeatForm.querySelector('.custom-repeat-footer')?.insertAdjacentElement('beforebegin', message);
    this.repeatValidationMessage = message;
  },

  showRepeatValidationError(message) {
    this.ensureRepeatValidationMessage();
    const text = message || 'Complete the repeat settings.';
    if (this.repeatValidationMessage) this.repeatValidationMessage.textContent = text;
    if (this.repeatMainValidationMessage) this.repeatMainValidationMessage.textContent = text;
    return false;
  },

  clearRepeatValidationError() {
    if (this.repeatValidationMessage) this.repeatValidationMessage.textContent = '';
    if (this.repeatMainValidationMessage) this.repeatMainValidationMessage.textContent = '';
  }
};
