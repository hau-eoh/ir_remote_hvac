class EraBridge {
  constructor() {
    this.listeners = {};
    this.debugMode = true;
    window.addEventListener('message', (e) => this._onMessage(e));
  }

  sendToPin(pin, jsonContent) {
    const payload = typeof jsonContent === 'string' ? jsonContent : JSON.stringify(jsonContent);
    
    // Build both 'control' and 'write' messages with both 'type' and 'action' keys
    const controlMsg = { type: 'control', action: 'control', pin: pin, value: payload };
    const writeMsg = { type: 'write', action: 'write', pin: pin, value: payload };
    
    // 1. Send as raw JS objects (standard for modern dashboards)
    window.parent.postMessage(controlMsg, '*');
    window.parent.postMessage(writeMsg, '*');
    
    // 2. Send as stringified JSON strings (for legacy/obfuscated dashboard versions)
    window.parent.postMessage(JSON.stringify(controlMsg), '*');
    window.parent.postMessage(JSON.stringify(writeMsg), '*');
    
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
