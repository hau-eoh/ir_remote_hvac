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

    // Deduplication tracking variables
    this.lastControlTime = null;
    this.lastControlRawString = null;
    this.lastLearnTime = null;
    this.lastLearnRawString = null;
  }

  initEraWidget() {
    window.eraWidget.init({
      // E-Ra defaults to 300px on mobile. Send the actual viewport height
      // when the widget is made ready so the host creates a full-height iframe.
      ready: false,
      mobileHeight: this.getMobileHeight(),
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

    window.eraWidget.ready();
    this.requestMobileHeight();
    window.addEventListener('resize', () => this.requestMobileHeight());
    window.visualViewport?.addEventListener('resize', () => this.requestMobileHeight());
  }

  getMobileHeight() {
    // The iframe itself starts at E-Ra's default 300px, so innerHeight and
    // visualViewport only report that clipped height. screen.height reports
    // the device viewport and lets the host expand the iframe to full screen.
    return Math.round(Math.max(
      window.screen?.height || 0,
      window.visualViewport?.height || 0,
      window.innerHeight
    ));
  }

  requestMobileHeight() {
    window.eraWidget.requestAdjustMobileHeight(this.getMobileHeight());
  }

  mapConfigsAndActions() {
    // Helper to extract virtual pin string
    const getPinStr = (c) => (c.virtualPin || c.virtual_pin || c.pin || c.virtualpin || '').toLowerCase();

    // 1. Map Control Config (to read status feedback)
    this.controlConfig = this.configs.find(c => {
      const name = (c.name || '').toLowerCase();
      const pin = getPinStr(c);
      return name.includes('control') || name.includes('điều khiển') || name.includes(this.controlPin.toLowerCase()) || pin === this.controlPin.toLowerCase();
    });
    if (!this.controlConfig && this.configs.length > 0) {
      // Find a config that matches the control pin exactly
      this.controlConfig = this.configs.find(c => getPinStr(c) === this.controlPin.toLowerCase());
      if (!this.controlConfig) {
        this.controlConfig = this.configs[0];
      }
    }

    // 2. Map Learn Config (to read learn updates)
    this.learnConfig = this.configs.find(c => {
      const name = (c.name || '').toLowerCase();
      const pin = getPinStr(c);
      return name.includes('learn') || name.includes('học') || name.includes(this.learnPin.toLowerCase()) || pin === this.learnPin.toLowerCase();
    });
    if (!this.learnConfig && this.configs.length > 1) {
      // Find a config that matches the learn pin exactly
      this.learnConfig = this.configs.find(c => getPinStr(c) === this.learnPin.toLowerCase());
      if (!this.learnConfig) {
        this.learnConfig = this.configs[1];
      }
    }

    // 3. Map Control Action (to send commands)
    this.controlAction = this.actions.find(a => {
      const name = (a.name || '').toLowerCase();
      const pin = getPinStr(a);
      return name.includes('control') || name.includes('điều khiển') || name.includes(this.controlPin.toLowerCase()) || pin === this.controlPin.toLowerCase();
    });
    if (!this.controlAction && this.actions.length > 0) {
      this.controlAction = this.actions.find(a => getPinStr(a) === this.controlPin.toLowerCase());
      if (!this.controlAction) {
        this.controlAction = this.actions[0];
      }
    }

    // 4. Map Learn Action (to send learning requests)
    this.learnAction = this.actions.find(a => {
      const name = (a.name || '').toLowerCase();
      const pin = getPinStr(a);
      return name.includes('learn') || name.includes('học') || name.includes(this.learnPin.toLowerCase()) || pin === this.learnPin.toLowerCase();
    });
    if (!this.learnAction && this.actions.length > 1) {
      this.learnAction = this.actions.find(a => getPinStr(a) === this.learnPin.toLowerCase());
      if (!this.learnAction) {
        this.learnAction = this.actions[1];
      }
    }
  }

  _handleEraWidgetValues(values) {
    try {
      // If control config value is received from E-Ra
      if (this.controlConfig && values[this.controlConfig.id] !== undefined) {
        const rawVal = values[this.controlConfig.id];
        const valTime = rawVal.time;
        const rawString = rawVal.value !== undefined ? rawVal.value : rawVal.v;
        
        // Deduplicate: process only if time stamp or raw value has changed
        if (valTime !== this.lastControlTime || rawString !== this.lastControlRawString) {
          this.lastControlTime = valTime;
          this.lastControlRawString = rawString;

          let val = rawString;
          if (typeof val === 'string') {
            try { val = JSON.parse(val); } catch(e) {}
          }
          
          // Emit only if it contains a valid AC JSON structure
          // Or if it is not an object (fallback checks)
          if (val && (typeof val !== 'object' || val.IrReceived || val.command || val.Vendor || val.vendor)) {
            this._emit(this.controlPin, val);
          }
        }
      }
      
      // If learn config value is received from E-Ra
      if (this.learnConfig && values[this.learnConfig.id] !== undefined) {
        const rawVal = values[this.learnConfig.id];
        const valTime = rawVal.time;
        const rawString = rawVal.value !== undefined ? rawVal.value : rawVal.v;

        // Deduplicate: process only if time stamp or raw value has changed
        if (valTime !== this.lastLearnTime || rawString !== this.lastLearnRawString) {
          this.lastLearnTime = valTime;
          this.lastLearnRawString = rawString;

          let val = rawString;
          if (typeof val === 'string') {
            try { val = JSON.parse(val); } catch(e) {}
          }
          this._emit(this.learnPin, val);
        }
      }
    } catch (e) {
      console.error('[ERA WIDGET VALUES ERROR]', e);
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
        let value = data.value !== undefined ? data.value : data.v;
        if (this.debugMode) console.log(`[ERA RX] ${data.pin}:`, value);
        if (typeof value === 'string') {
          try { value = JSON.parse(value); } catch(e) {}
        }
        this._emit(data.pin, value);
      }
    } catch (e) {
      console.error('[ERA RX ERROR]', e);
    }
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
