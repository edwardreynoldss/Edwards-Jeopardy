function formatMoney(n) {
  const neg = n < 0;
  const abs = Math.abs(Math.round(n));
  return (neg ? '-$' : '$') + abs.toLocaleString('en-US');
}

function ensureToastStack() {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

function showToast(message, isError = true) {
  const stack = ensureToastStack();
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.borderLeftColor = isError ? 'var(--jp-red)' : 'var(--jp-green)';
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

function ack(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => {
      if (response && response.ok === false) {
        showToast(response.error || 'Something went wrong.');
      }
      resolve(response);
    });
  });
}
