(function() {
  'use strict';

  // ===== CONFIGURATION =====
  const TEMP_MIN = 16;
  const TEMP_MAX = 30;
  const DIAL_CENTER_X = 150;
  const DIAL_CENTER_Y = 150;
  const DIAL_RADIUS = 120;
  const DIAL_START_ANGLE = 135;
  const DIAL_END_ANGLE = 405;
  const DIAL_SWEEP = DIAL_END_ANGLE - DIAL_START_ANGLE;
  const SCAN_TIMEOUT = 30;
  const LEARN_TIMEOUT = 15;
  const TEMP_DEBOUNCE = 500;

  const urlParams = new URLSearchParams(window.location.search);
  const PROFILE_INDEX = parseInt(urlParams.get('profile') || '0', 10);
  const CONTROL_PIN = `V${200 + PROFILE_INDEX}`;
  const LEARN_PIN = `V${210 + PROFILE_INDEX}`;

  // ===== STATE =====
  const state = {
    currentScreen: 'control',
    power: false,
    temperature: 24,
    mode: 'cool',
    fanSpeed: 'auto',
    swing: 'auto',
    setupSubScreen: 'menu',
    learnSteps: [],
    learnCurrentStep: 0,
    learnResults: {},
    learnCaptured: false,
    // Setup Profile Information state
    vendor: '—',
    model: '',
    setupMode: '—',
    learnedCount: '—',
  };

  const DEFAULT_LEARN_STEPS = [
    { key: 'power_on', command: 'power', value: 'on', label: 'Power On' },
    { key: 'power_off', command: 'power', value: 'off', label: 'Power Off' },
    { key: 'temp_24', command: 'temperature', value: 24, label: 'Temp 24°C' },
    { key: 'mode_cool', command: 'mode', value: 'cool', label: 'Mode Cool' },
    { key: 'fan_auto', command: 'fan_speed', value: 'auto', label: 'Fan Auto' },
    { key: 'swing_auto', command: 'swing', value: 'auto', label: 'Swing Auto' },
  ];

  // ===== DOM REFS =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ===== UTILITY FUNCTIONS =====

  function polarToCartesian(cx, cy, r, angleDeg) {
    const rad = (angleDeg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function describeArc(cx, cy, r, startAngle, endAngle) {
    const start = polarToCartesian(cx, cy, r, startAngle);
    const end = polarToCartesian(cx, cy, r, endAngle);
    const sweep = endAngle - startAngle;
    const largeArc = sweep > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  }

  function tempToAngle(temp) {
    const ratio = (temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);
    return DIAL_START_ANGLE + ratio * DIAL_SWEEP;
  }

  function angleToTemp(angle) {
    let a = angle;
    if (a < DIAL_START_ANGLE) a += 360;
    const ratio = (a - DIAL_START_ANGLE) / DIAL_SWEEP;
    return Math.round(Math.min(TEMP_MAX, Math.max(TEMP_MIN, TEMP_MIN + ratio * (TEMP_MAX - TEMP_MIN))));
  }

  // ===== TOAST SYSTEM =====

  function showToast(message, type = 'info', duration = 2500) {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ===== E-RA COMMUNICATION =====

  function sendCommand(command, value) {
    if (!state.power && command !== 'power') {
      showToast('Turn on AC first', 'warning');
      return;
    }
    era.sendToPin(CONTROL_PIN, { command, value });
    showToast(`${command}: ${value}`, 'info');
  }

  function sendLearn(action, command, value) {
    const payload = { action };
    if (command) payload.command = command;
    if (value !== undefined) payload.value = value;
    era.sendToPin(LEARN_PIN, payload);
  }

  // ===== DIAL COMPONENT =====

  let dialDragging = false;
  let tempDebounceTimer = null;

  function initDial() {
    const trackPath = $('#dial-track');
    const ticksGroup = $('#dial-ticks');
    const labelsGroup = $('#dial-labels');

    trackPath.setAttribute('d', describeArc(DIAL_CENTER_X, DIAL_CENTER_Y, DIAL_RADIUS, DIAL_START_ANGLE, DIAL_END_ANGLE));

    for (let t = TEMP_MIN; t <= TEMP_MAX; t++) {
      const angle = tempToAngle(t);
      const isMajor = t % 2 === 0;
      const innerR = isMajor ? DIAL_RADIUS - 16 : DIAL_RADIUS - 10;
      const outerR = DIAL_RADIUS - 4;
      const p1 = polarToCartesian(DIAL_CENTER_X, DIAL_CENTER_Y, innerR, angle);
      const p2 = polarToCartesian(DIAL_CENTER_X, DIAL_CENTER_Y, outerR, angle);
      const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tick.setAttribute('x1', p1.x);
      tick.setAttribute('y1', p1.y);
      tick.setAttribute('x2', p2.x);
      tick.setAttribute('y2', p2.y);
      tick.setAttribute('stroke', isMajor ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.07)');
      tick.setAttribute('stroke-width', isMajor ? '2' : '1');
      tick.setAttribute('stroke-linecap', 'round');
      ticksGroup.appendChild(tick);
    }

    [16, 20, 24, 28, 30].forEach(t => {
      const angle = tempToAngle(t);
      const pos = polarToCartesian(DIAL_CENTER_X, DIAL_CENTER_Y, DIAL_RADIUS - 28, angle);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', pos.x);
      label.setAttribute('y', pos.y);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('fill', 'rgba(255,255,255,0.25)');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-family', 'Inter, sans-serif');
      label.textContent = t + '°';
      labelsGroup.appendChild(label);
    });

    updateDial();
    setupDialDrag();
  }

  function updateDial() {
    const fillPath = $('#dial-fill');
    const handle = $('#dial-handle');
    const tempValue = $('#temp-value');

    const angle = tempToAngle(state.temperature);
    fillPath.setAttribute('d', describeArc(DIAL_CENTER_X, DIAL_CENTER_Y, DIAL_RADIUS, DIAL_START_ANGLE, angle));

    const handlePos = polarToCartesian(DIAL_CENTER_X, DIAL_CENTER_Y, DIAL_RADIUS, angle);
    handle.setAttribute('cx', handlePos.x);
    handle.setAttribute('cy', handlePos.y);

    tempValue.textContent = state.temperature;
  }

  function setupDialDrag() {
    const svg = $('#dial-svg');
    const handle = $('#dial-handle');

    function getAngleFromEvent(e) {
      const rect = svg.getBoundingClientRect();
      const scaleX = 300 / rect.width;
      const scaleY = 300 / rect.height;
      let clientX, clientY;
      if (e.touches) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      const x = (clientX - rect.left) * scaleX - DIAL_CENTER_X;
      const y = (clientY - rect.top) * scaleY - DIAL_CENTER_Y;
      let angle = Math.atan2(y, x) * 180 / Math.PI + 90;
      if (angle < 0) angle += 360;
      return angle;
    }

    function onDragStart(e) {
      e.preventDefault();
      dialDragging = true;
      handle.style.cursor = 'grabbing';
    }

    function onDragMove(e) {
      if (!dialDragging) return;
      e.preventDefault();
      const angle = getAngleFromEvent(e);
      let normalizedAngle = angle;
      if (normalizedAngle > 45 && normalizedAngle < 135) {
        if (normalizedAngle < 90) normalizedAngle = 45;
        else normalizedAngle = 135;
      }
      const temp = angleToTemp(normalizedAngle);
      if (temp !== state.temperature) {
        state.temperature = temp;
        updateDial();
        clearTimeout(tempDebounceTimer);
        tempDebounceTimer = setTimeout(() => {
          sendCommand('temperature', state.temperature);
        }, TEMP_DEBOUNCE);
      }
    }

    function onDragEnd() {
      if (dialDragging) {
        dialDragging = false;
        handle.style.cursor = 'grab';
      }
    }

    handle.addEventListener('mousedown', onDragStart);
    svg.addEventListener('mousedown', (e) => {
      if (e.target === handle) return;
      const angle = getAngleFromEvent(e);
      let normalizedAngle = angle;
      if (normalizedAngle > 45 && normalizedAngle < 135) return;
      const temp = angleToTemp(normalizedAngle);
      state.temperature = temp;
      updateDial();
      clearTimeout(tempDebounceTimer);
      tempDebounceTimer = setTimeout(() => {
        sendCommand('temperature', state.temperature);
      }, TEMP_DEBOUNCE);
    });
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    handle.addEventListener('touchstart', onDragStart, { passive: false });
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);
  }

  // ===== SCREEN NAVIGATION =====

  function showScreen(screenName) {
    state.currentScreen = screenName;
    $$('.screen').forEach(s => s.classList.remove('active'));
    $(`#screen-${screenName}`).classList.add('active');

    const settingsBtn = $('#btn-settings');

    if (screenName === 'control') {
      $('#btn-back').classList.add('hidden');
      $('#ac-title').textContent = 'Air Condition';
      if (settingsBtn) settingsBtn.classList.remove('hidden');
    } else {
      $('#btn-back').classList.remove('hidden');
      $('#ac-title').textContent = screenName === 'setup' ? 'Setup' : 'Learn Commands';
      if (settingsBtn) settingsBtn.classList.add('hidden');
    }
    saveState();
  }

  // ===== CONTROL PANEL LOGIC =====

  function initControlPanel() {
    $('#power-checkbox').addEventListener('change', (e) => {
      state.power = e.target.checked;
      document.getElementById('app').classList.toggle('power-off', !state.power);
      sendCommand('power', state.power ? 'on' : 'off');
      $('#ac-status').textContent = state.power ? getModeLabel(state.mode) : 'Off';
      saveState();
    });

    $$('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        state.mode = mode;
        $$('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sendCommand('mode', mode);
        $('#ac-status').textContent = getModeLabel(mode);
        saveState();
      });
    });

    $('#btn-temp-up').addEventListener('click', () => {
      if (state.temperature < TEMP_MAX) {
        state.temperature++;
        updateDial();
        sendCommand('temperature', state.temperature);
        saveState();
      }
    });

    $('#btn-temp-down').addEventListener('click', () => {
      if (state.temperature > TEMP_MIN) {
        state.temperature--;
        updateDial();
        sendCommand('temperature', state.temperature);
        saveState();
      }
    });

    $$('#fan-selector .pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = btn.dataset.speed;
        state.fanSpeed = speed;
        $$('#fan-selector .pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sendCommand('fan_speed', speed);
        saveState();
      });
    });

    $$('#swing-selector .pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const swing = btn.dataset.swing;
        state.swing = swing;
        $$('#swing-selector .pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sendCommand('swing', swing);
        saveState();
      });
    });

    $('#btn-settings').addEventListener('click', () => {
      showSetupMenu();
      showScreen('setup');
    });

    $('#btn-back').addEventListener('click', () => {
      if (state.currentScreen === 'setup') {
        if (state.setupSubScreen !== 'menu') {
          showSetupMenu();
          return;
        }
      }
      showScreen('control');
    });
  }

  function getModeLabel(mode) {
    const labels = { auto: 'Auto', cool: 'Cooling', heat: 'Heating', dry: 'Drying', fan: 'Fan Only' };
    return labels[mode] || mode;
  }

  // ===== SETUP WIZARD LOGIC =====

  let scanTimer = null;
  let scanSeconds = 0;

  function showSetupMenu() {
    state.setupSubScreen = 'menu';
    $('#setup-menu').classList.remove('hidden');
    $('#setup-scan').classList.add('hidden');
    $('#setup-vendor').classList.add('hidden');
    $('#setup-test').classList.add('hidden');
  }

  function showSetupSubScreen(name) {
    state.setupSubScreen = name;
    $('#setup-menu').classList.add('hidden');
    $('#setup-scan').classList.add('hidden');
    $('#setup-vendor').classList.add('hidden');
    $('#setup-test').classList.add('hidden');
    $(`#setup-${name}`).classList.remove('hidden');
  }

  function initSetupWizard() {
    $('#btn-scan').addEventListener('click', () => {
      showSetupSubScreen('scan');
      startScan();
    });

    $('#btn-manual').addEventListener('click', () => {
      showSetupSubScreen('vendor');
    });

    $('#btn-learn-start').addEventListener('click', () => {
      startLearnWizard();
    });

    $('#btn-scan-cancel').addEventListener('click', () => {
      stopScan();
      showSetupMenu();
    });
    $('#btn-scan-retry').addEventListener('click', () => {
      startScan();
    });
    $('#btn-scan-continue').addEventListener('click', () => {
      showSetupSubScreen('test');
    });

    $('#vendor-select').addEventListener('change', (e) => {
      const vendor = e.target.value;
      const modelSelect = $('#model-select');
      if (vendor) {
        modelSelect.disabled = false;
        modelSelect.innerHTML = '<option value="">— Select model —</option>';
        for (let i = 1; i <= 5; i++) {
          modelSelect.innerHTML += `<option value="${i}">${i}</option>`;
        }
      } else {
        modelSelect.disabled = true;
        modelSelect.innerHTML = '<option value="">— Select model —</option>';
      }
      updateTestLibraryBtn();
    });
    $('#model-select').addEventListener('change', updateTestLibraryBtn);

    $('#btn-test-library').addEventListener('click', () => {
      showSetupSubScreen('test');
    });

    $$('.test-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const step = btn.closest('.test-step');
        const testKey = step.dataset.test;
        const commands = {
          power_on: { command: 'power', value: 'on' },
          temp_24: { command: 'temperature', value: 24 },
          power_off: { command: 'power', value: 'off' },
        };
        const cmd = commands[testKey];
        if (cmd) {
          era.sendToPin(CONTROL_PIN, cmd);
          btn.textContent = '✓ Sent';
          btn.disabled = true;
          step.querySelector('.test-step-status').textContent = '📡';
          setTimeout(() => {
            btn.textContent = '▶ Test';
            btn.disabled = false;
          }, 2000);
        }
      });
    });

    $('#btn-test-pass').addEventListener('click', () => {
      sendLearn('save');
      
      // Update local profile info and UI
      const vendor = $('#vendor-select').value;
      const model = $('#model-select').value;
      state.vendor = vendor;
      state.model = model;
      state.setupMode = 'Manual Select';
      state.learnedCount = 'No';
      saveProfileSetupState();
      applySetupStateToUI();

      showToast('Configuration saved!', 'success');
      showScreen('control');
    });

    $('#btn-test-fail').addEventListener('click', () => {
      startLearnWizard();
    });

    // Clear Setup Click Handler
    const clearBtn = $('#btn-clear-setup');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Bạn có chắc chắn muốn xóa cấu hình hiện tại để học/quét lại không?')) {
          sendLearn('clear_all');
          
          state.vendor = '—';
          state.model = '';
          state.setupMode = '—';
          state.learnedCount = '—';
          saveProfileSetupState();
          applySetupStateToUI();
          
          const vendorSelect = $('#vendor-select');
          if (vendorSelect) {
            vendorSelect.value = '';
            const event = new Event('change');
            vendorSelect.dispatchEvent(event);
          }
          
          showToast('Đã xóa cấu hình thành công!', 'success');
        }
      });
    }

    // Listen to control pin for scan result updates from Gateway
    era.onPinUpdate(CONTROL_PIN, (value) => {
      if (value && value.IrReceived) {
        onScanResultReceived(value.IrReceived);
      }
      // Also catch direct setup updates sent via V20X
      if (value && (value.vendor || value.Vendor)) {
        onGatewaySetupReceived(value);
      }
    });

    // Listen to learn status pin for gateway setup updates
    era.onPinUpdate(LEARN_PIN, (value) => {
      if (value && (value.vendor || value.Vendor)) {
        onGatewaySetupReceived(value);
      }
    });
  }

  function saveProfileSetupState() {
    const data = {
      vendor: state.vendor || '—',
      model: state.model || '',
      setupMode: state.setupMode || '—',
      learnedCount: state.learnedCount !== undefined ? state.learnedCount : '—'
    };
    try {
      localStorage.setItem(`era-ir-ac-setup-${PROFILE_INDEX}`, JSON.stringify(data));
    } catch (e) {}
  }

  function loadProfileSetupState() {
    try {
      const data = JSON.parse(localStorage.getItem(`era-ir-ac-setup-${PROFILE_INDEX}`));
      if (data) {
        state.vendor = data.vendor || '—';
        state.model = data.model || '';
        state.setupMode = data.setupMode || '—';
        state.learnedCount = data.learnedCount !== undefined ? data.learnedCount : '—';
      } else {
        state.vendor = '—';
        state.model = '';
        state.setupMode = '—';
        state.learnedCount = '—';
      }
    } catch (e) {
      state.vendor = '—';
      state.model = '';
      state.setupMode = '—';
      state.learnedCount = '—';
    }
  }

  function applySetupStateToUI() {
    const mode = state.setupMode || '—';
    const vendor = state.vendor || '—';
    const model = state.model || '';
    const learned = state.learnedCount !== undefined ? state.learnedCount : '—';

    const infoMode = $('#info-mode');
    const infoVendor = $('#info-vendor');
    const infoLearned = $('#info-learned');

    if (infoMode) infoMode.textContent = mode;
    if (infoVendor) infoVendor.textContent = model ? `${vendor} (Model ${model})` : vendor;
    if (infoLearned) infoLearned.textContent = typeof learned === 'boolean' ? (learned ? 'Yes' : 'No') : String(learned);
  }

  function onGatewaySetupReceived(data) {
    if (!data) return;
    const vendor = data.vendor || data.Vendor || '—';
    const model = data.model !== undefined && data.model !== null && data.model !== -1 ? String(data.model) : '';
    const mode = data.mode || data.Mode || '—';
    const learned = data.learned !== undefined ? data.learned : '—';

    state.vendor = vendor;
    state.model = model;
    state.setupMode = mode;
    state.learnedCount = learned;

    saveProfileSetupState();
    applySetupStateToUI();
  }



  const BRANDS = [
    "COOLIX", "DAIKIN", "PANASONIC", "MITSUBISHI", "TOSHIBA",
    "LG", "SAMSUNG", "SHARP", "CARRIER", "GREE",
    "MIDEA", "FUJITSU", "HITACHI", "HAIER", "SANYO"
  ];

  function populateBrands() {
    const select = $('#vendor-select');
    if (select) {
      select.innerHTML = '<option value="">— Select vendor —</option>';
      BRANDS.forEach(brand => {
        select.innerHTML += `<option value="${brand}">${brand}</option>`;
      });
    }
  }

  function updateTestLibraryBtn() {
    const vendor = $('#vendor-select').value;
    const model = $('#model-select').value;
    $('#btn-test-library').disabled = !(vendor && model);
  }

  function onScanResultReceived(irData) {
    if (!irData) return;
    
    // Stop the scan timer
    stopScan();
    
    const hvac = irData.IRhvac || {};
    const vendor = hvac.Vendor || irData.Protocol || '';
    let model = hvac.Model;
    if (model === -1 || model === undefined || model === null) {
      model = '1'; // Default fallback model
    } else {
      model = String(model);
    }

    const scanResult = $('#scan-result');
    const btnCancel = $('#btn-scan-cancel');
    const btnRetry = $('#btn-scan-retry');
    const btnContinue = $('#btn-scan-continue');

    // Display scanned remote info
    scanResult.innerHTML = `Tìm thấy Remote!<br><strong>Hãng:</strong> ${vendor}<br><strong>Model:</strong> ${model}`;
    scanResult.classList.remove('hidden');
    scanResult.style.color = 'var(--success)';
    
    btnCancel.classList.add('hidden');
    btnRetry.classList.remove('hidden');
    btnContinue.classList.remove('hidden');

    // Auto-populate manual brand/model selection
    const vendorSelect = $('#vendor-select');
    if (vendorSelect) {
      const normalizedVendor = vendor.toUpperCase();
      let exists = false;
      for (let i = 0; i < vendorSelect.options.length; i++) {
        if (vendorSelect.options[i].value.toUpperCase() === normalizedVendor) {
          vendorSelect.selectedIndex = i;
          exists = true;
          break;
        }
      }
      if (!exists) {
        vendorSelect.innerHTML += `<option value="${vendor}">${vendor}</option>`;
        vendorSelect.value = vendor;
      }
      
      // Dispatch change event to model dropdown
      const event = new Event('change');
      vendorSelect.dispatchEvent(event);
      
      const modelSelect = $('#model-select');
      if (modelSelect) {
        modelSelect.value = model;
        if (!modelSelect.value) {
          modelSelect.innerHTML += `<option value="${model}">${model}</option>`;
          modelSelect.value = model;
        }
      }
      updateTestLibraryBtn();
    }

    // Save to state and update E-Ra profile info view
    state.vendor = vendor;
    state.model = model;
    state.setupMode = 'Auto Scan';
    state.learnedCount = 'No';
    saveProfileSetupState();
    applySetupStateToUI();

    showToast(`Scanned remote: ${vendor}`, 'success');
  }

  function startScan() {
    scanSeconds = SCAN_TIMEOUT;
    const timerBar = $('.scan-timer-bar');
    const scanResult = $('#scan-result');
    const btnCancel = $('#btn-scan-cancel');
    const btnRetry = $('#btn-scan-retry');
    const btnContinue = $('#btn-scan-continue');

    scanResult.classList.add('hidden');
    btnRetry.classList.add('hidden');
    btnContinue.classList.add('hidden');
    btnCancel.classList.remove('hidden');
    timerBar.style.width = '100%';

    era.sendToPin(CONTROL_PIN, { command: 'scan' });

    clearInterval(scanTimer);
    scanTimer = setInterval(() => {
      scanSeconds--;
      const pct = (scanSeconds / SCAN_TIMEOUT) * 100;
      timerBar.style.width = pct + '%';

      if (scanSeconds <= 0) {
        clearInterval(scanTimer);
        scanResult.textContent = 'Không tìm thấy remote. Thử lại hoặc chọn thủ công.';
        scanResult.classList.remove('hidden');
        scanResult.style.color = 'var(--warning)';
        btnCancel.classList.add('hidden');
        btnRetry.classList.remove('hidden');
      }
    }, 1000);
  }

  function stopScan() {
    clearInterval(scanTimer);
  }

  // ===== LEARN WIZARD LOGIC =====

  let learnTimer = null;

  function startLearnWizard() {
    state.learnSteps = [...DEFAULT_LEARN_STEPS];
    state.learnCurrentStep = 0;
    state.learnResults = {};
    state.learnCaptured = false;
    showScreen('learn');
    updateLearnUI();
  }

  function updateLearnUI() {
    const step = state.learnSteps[state.learnCurrentStep];
    if (!step) {
      showLearnComplete();
      return;
    }

    $('#learn-step-count').textContent = `Step ${state.learnCurrentStep + 1}/${state.learnSteps.length}`;
    $('#learn-step-label').textContent = step.label;
    $('#learn-instruction').innerHTML = `Bấm nút <strong>${step.label}</strong> trên remote của bạn`;

    state.learnCaptured = false;
    $('#learn-captured').classList.add('hidden');
    $('#btn-learn-test').classList.add('hidden');
    $('#btn-learn-retry').classList.add('hidden');
    $('#btn-learn-next').classList.add('hidden');
    $('#btn-learn-skip').classList.remove('hidden');

    $('#learn-active').classList.remove('hidden');
    $('#learn-complete').classList.add('hidden');

    const progressContainer = $('#learn-progress');
    progressContainer.innerHTML = '';
    state.learnSteps.forEach((s, i) => {
      const dot = document.createElement('span');
      dot.className = 'learn-dot';
      if (state.learnResults[s.key] === 'done') dot.classList.add('done');
      else if (state.learnResults[s.key] === 'skipped') dot.classList.add('skipped');
      else if (i === state.learnCurrentStep) dot.classList.add('current');
      progressContainer.appendChild(dot);
    });

    const list = $('#learn-checklist-list');
    list.innerHTML = '';
    state.learnSteps.forEach(s => {
      const li = document.createElement('li');
      const status = state.learnResults[s.key];
      let iconHtml = '<span class="check-icon check-pending">○</span>';
      if (status === 'done') iconHtml = '<span class="check-icon check-done">✓</span>';
      else if (status === 'skipped') iconHtml = '<span class="check-icon check-skipped">⏭</span>';
      li.innerHTML = `${iconHtml} <span>${s.label}</span>`;
      list.appendChild(li);
    });

    sendLearn('learn', step.command, step.value);
    showToast(`Learning: ${step.label}`, 'info');

    startLearnTimer();
  }

  function startLearnTimer() {
    clearTimeout(learnTimer);
    learnTimer = setTimeout(() => {
      if (!state.learnCaptured) {
        showToast('Timeout — không nhận được tín hiệu', 'warning');
      }
    }, LEARN_TIMEOUT * 1000);
  }

  function onLearnCaptured() {
    state.learnCaptured = true;
    clearTimeout(learnTimer);
    $('#learn-captured').classList.remove('hidden');
    $('#btn-learn-test').classList.remove('hidden');
    $('#btn-learn-retry').classList.remove('hidden');
    $('#btn-learn-next').classList.remove('hidden');
    $('#btn-learn-skip').classList.add('hidden');
  }

  function showLearnComplete() {
    $('#learn-active').classList.add('hidden');
    $('#learn-complete').classList.remove('hidden');

    const doneCount = Object.values(state.learnResults).filter(v => v === 'done').length;
    const total = state.learnSteps.length;
    $('#learn-summary').textContent = `${doneCount}/${total} commands learned successfully`;

    const skippedCount = Object.values(state.learnResults).filter(v => v === 'skipped').length;
    $('#btn-learn-relearn').style.display = skippedCount > 0 ? '' : 'none';
  }

  function initLearnWizard() {
    $('#btn-learn-skip').addEventListener('click', () => {
      const step = state.learnSteps[state.learnCurrentStep];
      state.learnResults[step.key] = 'skipped';
      state.learnCurrentStep++;
      updateLearnUI();
    });

    $('#btn-learn-test').addEventListener('click', () => {
      const step = state.learnSteps[state.learnCurrentStep];
      era.sendToPin(CONTROL_PIN, { command: step.command, value: step.value });
      showToast(`Testing: ${step.label}`, 'info');
    });

    $('#btn-learn-retry').addEventListener('click', () => {
      state.learnCaptured = false;
      updateLearnUI();
    });

    $('#btn-learn-next').addEventListener('click', () => {
      const step = state.learnSteps[state.learnCurrentStep];
      state.learnResults[step.key] = 'done';
      state.learnCurrentStep++;
      updateLearnUI();
    });

    $('#btn-learn-save').addEventListener('click', () => {
      sendLearn('save');
      
      const doneCount = Object.values(state.learnResults).filter(v => v === 'done').length;
      const total = state.learnSteps.length;
      
      state.vendor = 'Custom Remote';
      state.model = '';
      state.setupMode = 'Learn Commands';
      state.learnedCount = `${doneCount}/${total}`;
      saveProfileSetupState();
      applySetupStateToUI();

      showToast('Setup saved!', 'success');
      showScreen('control');
    });

    $('#btn-learn-relearn').addEventListener('click', () => {
      const firstSkipped = state.learnSteps.findIndex(s => state.learnResults[s.key] === 'skipped');
      if (firstSkipped >= 0) {
        state.learnCurrentStep = firstSkipped;
        delete state.learnResults[state.learnSteps[firstSkipped].key];
        updateLearnUI();
      }
    });

    era.onPinUpdate(LEARN_PIN, (value) => {
      if (value && (value.status === 'captured' || value.status === 'learned' || value === 'captured')) {
        onLearnCaptured();
      }
    });
  }

  // ===== STATE PERSISTENCE =====

  function saveState() {
    const data = {
      power: state.power,
      temperature: state.temperature,
      mode: state.mode,
      fanSpeed: state.fanSpeed,
      swing: state.swing,
    };
    try {
      localStorage.setItem(`era-ir-ac-${PROFILE_INDEX}`, JSON.stringify(data));
    } catch (e) {}
  }

  function loadState() {
    try {
      const data = JSON.parse(localStorage.getItem(`era-ir-ac-${PROFILE_INDEX}`));
      if (data) {
        state.power = data.power || false;
        state.temperature = data.temperature || 24;
        state.mode = data.mode || 'cool';
        state.fanSpeed = data.fanSpeed || 'auto';
        state.swing = data.swing || 'auto';
      }
    } catch (e) {}
  }

  function applyStateToUI() {
    $('#power-checkbox').checked = state.power;
    document.getElementById('app').classList.toggle('power-off', !state.power);
    $('#ac-status').textContent = state.power ? getModeLabel(state.mode) : 'Off';

    $$('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === state.mode);
    });

    updateDial();

    $$('#fan-selector .pill-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.speed === state.fanSpeed);
    });

    $$('#swing-selector .pill-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.swing === state.swing);
    });
  }

  // ===== INIT =====

  function init() {
    loadState();
    loadProfileSetupState();
    populateBrands();
    initDial();
    initControlPanel();
    initSetupWizard();
    initLearnWizard();
    applyStateToUI();
    applySetupStateToUI();

    // Query gateway for current setup state on startup
    setTimeout(() => {
      sendLearn('query');
    }, 1000);

    const profileNames = ['AC #1', 'AC #2', 'AC #3'];
    document.title = `${profileNames[PROFILE_INDEX] || 'AC'} — IR Control`;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
