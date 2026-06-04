class EraBridge {
  constructor() {
    this.listeners = {};
    this.debugMode = true;
    window.addEventListener('message', (e) => this._onMessage(e));
  }

  sendToPin(pin, jsonContent) {
    const payload = typeof jsonContent === 'string' ? jsonContent : JSON.stringify(jsonContent);
    const message = { type: 'control', pin: pin, value: payload };
    window.parent.postMessage(JSON.stringify(message), '*');
    if (this.debugMode) console.log(`[ERA TX] ${pin}:`, jsonContent);
  }

  _onMessage(event) {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data && data.pin) {
        if (this.debugMode) console.log(`[ERA RX] ${data.pin}:`, data.value);
        let value = data.value;
        if (typeof value === 'string') {
          try { value = JSON.parse(value); } catch(e) {}
        }
        this._emit(data.pin, value);
      }
    } catch (e) {}
  }

  onPinUpdate(pin, callback) {
    if (!this.listeners[pin]) this.listeners[pin] = [];
    this.listeners[pin].push(callback);
  }

  offPinUpdate(pin, callback) {
    if (!this.listeners[pin]) return;
    this.listeners[pin] = this.listeners[pin].filter(cb => cb !== callback);
  }

  _emit(pin, value) {
    (this.listeners[pin] || []).forEach(cb => cb(value));
  }
}

const era = new EraBridge();
