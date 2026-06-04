class EraBridge {
  constructor() {
    this.listeners = {};
    this.debugMode = true;
    this.isEraWidget = false;
    this.configs = [];
    this.actions = [];

    const urlParams = new URLSearchParams(window.location.search);
    this.profileIndex = parseInt(urlParams.get('profile') || '0', 10);
    this.controlPin = `V${200 + this.profileIndex}`;
    this.learnPin = `V${210 + this.profileIndex}`;

    // Detect if E-Ra widget SDK is available and active
    if (urlParams.has('eraOrigin') && urlParams.has('eraWidget') && window.eraWidget) {
      this.isEraWidget = true;
      this.initEraWidget();
    } else {
      window.addEventListener('message', (e) => this._onMessage(e));
    }
  }

  initEraWidget() {
    window.eraWidget.init({
      needRealtimeConfigs: true,
      needHistoryConfigs: false,
      needActions: true,
      maxRealtimeConfigsCount: 3,
      maxHistoryConfigsCount: 0,
      maxActionsCount: 3,
      minRealtimeConfigsCount: 1,
      minHistoryConfigsCount: 0,
      minActionsCount: 1,

      onConfiguration: (configuration) => {
        if (this.debugMode) console.log('[ERA CONFIG]', configuration);
        this.configs = configuration.realtime_configs || [];
        this.actions = configuration.actions || [];
        this.mapConfigsAndActions();
      },

      onValues: (values) => {
        if (this.debugMode) console.log('[ERA VALUES]', values);
        this._handleEraWidgetValues(values);
      }
    });
  }

  mapConfigsAndActions() {
    // 1. Map Control Config (to read status feedback)
    this.controlConfig = this.configs.find(c => {
      const name = (c.name || '').toLowerCase();
      return name.includes('control') || name.includes('điều khiển') || name.includes(this.controlPin.toLowerCase());
    });
    if (!this.controlConfig && this.configs.length > 0) {
      this.controlConfig = this.configs[0];
    }

    // 2. Map Learn Config (to read learn updates)
    this.learnConfig = this.configs.find(c => {
      const name = (c.name || '').toLowerCase();
      return name.includes('learn') || name.includes('học') || name.includes(this.learnPin.toLowerCase());
    });
    if (!this.learnConfig && this.configs.length > 1) {
      this.learnConfig = this.configs[1];
    }

    // 3. Map Control Action (to send commands)
    this.controlAction = this.actions.find(a => {
      const name = (a.name || '').toLowerCase();
      return name.includes('control') || name.includes('điều khiển') || name.includes(this.controlPin.toLowerCase());
    });
    if (!this.controlAction && this.actions.length > 0) {
      this.controlAction = this.actions[0];
    }

    // 4. Map Learn Action (to send learning requests)
    this.learnAction = this.actions.find(a => {
      const name = (a.name || '').toLowerCase();
      return name.includes('learn') || name.includes('học') || name.includes(this.learnPin.toLowerCase());
    });
    if (!this.learnAction && this.actions.length > 1) {
      this.learnAction = this.actions[1];
    }
  }

  _handleEraWidgetValues(values) {
    // If control config value is received from E-Ra
    if (this.controlConfig && values[this.controlConfig.id] !== undefined) {
      let val = values[this.controlConfig.id].value;
      if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch(e) {}
      }
      this._emit(this.controlPin, val);
    }
    
    // If learn config value is received from E-Ra
    if (this.learnConfig && values[this.learnConfig.id] !== undefined) {
      let val = values[this.learnConfig.id].value;
      if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch(e) {}
      }
      this._emit(this.learnPin, val);
    }
  }

  sendToPin(pin, jsonContent) {
    const payloadStr = typeof jsonContent === 'string' ? jsonContent : JSON.stringify(jsonContent);
    const payloadObj = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;

    // 1. E-Ra official Widget Mode (triggerAction)
    if (this.isEraWidget) {
      // We wrap the command inside the 'value' field.
      // If E-Ra extracts '.value' to write, it gets the entire nested object.
      // We also spread the flat values for dashboard configuration compatibility.
      const actionData = {
        value: payloadStr,
        command: payloadObj.command || '',
        cmdValue: payloadObj.value !== undefined ? payloadObj.value : ''
      };

      if (pin === this.controlPin && this.controlAction) {
        window.eraWidget.triggerAction(this.controlAction.action, null, actionData);
        if (this.debugMode) console.log(`[ERA WIDGET TX] ${pin} (Action: ${this.controlAction.action}):`, actionData);
      } else if (pin === this.learnPin && this.learnAction) {
        window.eraWidget.triggerAction(this.learnAction.action, null, actionData);
        if (this.debugMode) console.log(`[ERA WIDGET TX] ${pin} (Action: ${this.learnAction.action}):`, actionData);
      }
    }

    // 2. Direct postMessage Mode (Runs concurrently)
    // This bypasses Action mapping and writes the full raw JSON string directly to the Virtual Pin
    const controlMsg = { type: 'control', action: 'control', pin: pin, value: payloadStr };
    const writeMsg = { type: 'write', action: 'write', pin: pin, value: payloadStr };
    
    window.parent.postMessage(controlMsg, '*');
    window.parent.postMessage(writeMsg, '*');
    window.parent.postMessage(JSON.stringify(controlMsg), '*');
    window.parent.postMessage(JSON.stringify(writeMsg), '*');
    
    if (this.debugMode) console.log(`[ERA DIRECT TX] ${pin}:`, payloadStr);
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
