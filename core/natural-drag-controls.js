const originalAddEventListener = HTMLCanvasElement.prototype.addEventListener;
const originalRemoveEventListener = HTMLCanvasElement.prototype.removeEventListener;
const canvasStates = new WeakMap();

function getState(canvas) {
  let state = canvasStates.get(canvas);
  if (!state) {
    state = { mouseStartY: new Map(), wrappers: new Map() };
    canvasStates.set(canvas, state);
  }
  return state;
}

function getListenerMap(state, type) {
  let listeners = state.wrappers.get(type);
  if (!listeners) {
    listeners = new WeakMap();
    state.wrappers.set(type, listeners);
  }
  return listeners;
}

function adjustedPointerEvent(event, clientY) {
  return new Proxy(event, {
    get(target, property) {
      if (property === 'clientY') return clientY;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

HTMLCanvasElement.prototype.addEventListener = function addNaturalDragListener(type, listener, options) {
  if (this.id !== 'lofiLivingCanvas' || typeof listener !== 'function' || !['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].includes(type)) {
    return originalAddEventListener.call(this, type, listener, options);
  }

  const state = getState(this);
  const listeners = getListenerMap(state, type);
  let wrapped = listeners.get(listener);

  if (!wrapped) {
    wrapped = function naturalDragEvent(event) {
      if (event.pointerType === 'mouse' && type === 'pointerdown') {
        state.mouseStartY.set(event.pointerId, event.clientY);
      }

      let deliveredEvent = event;
      if (event.pointerType === 'mouse' && type === 'pointermove' && state.mouseStartY.has(event.pointerId)) {
        const startY = state.mouseStartY.get(event.pointerId);
        deliveredEvent = adjustedPointerEvent(event, startY - (event.clientY - startY));
      }

      try {
        return listener.call(this, deliveredEvent);
      } finally {
        if (event.pointerType === 'mouse' && (type === 'pointerup' || type === 'pointercancel')) {
          state.mouseStartY.delete(event.pointerId);
        }
      }
    };
    listeners.set(listener, wrapped);
  }

  return originalAddEventListener.call(this, type, wrapped, options);
};

HTMLCanvasElement.prototype.removeEventListener = function removeNaturalDragListener(type, listener, options) {
  const state = canvasStates.get(this);
  const wrapped = state?.wrappers.get(type)?.get(listener);
  return originalRemoveEventListener.call(this, type, wrapped || listener, options);
};
