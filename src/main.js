/**
 * FocusFlow — Core Pomodoro Timer with Audio, Notifications, Themes & Shortcuts
 * 
 * Tech Stack: Vanilla JavaScript (ES Modules)
 * 
 * Polish Features:
 * - Drift-free timestamp countdown
 * - Animated SVG progress ring
 * - Dark / Light theme toggle with persistence
 * - Gentle completion chime via Web Audio API (Zero audio dependencies)
 * - Optional browser notifications with permission checks
 * - Accessible keyboard shortcuts (Space to start/pause, R to reset)
 * - Motion accessibility (prefers-reduced-motion)
 */

import './style.css';

/* ==========================================================================
   1. Configuration, Durations & Storage Constants
   ========================================================================== */

const STORAGE_KEY = 'focusflow_preferences';

/** Default durations in minutes */
const DEFAULT_DURATIONS = {
  'focus': 25,
  'short-break': 5,
  'long-break': 15,
};

/** Validation constraints (in minutes) */
const DURATION_LIMITS = {
  'focus': { min: 1, max: 90 },
  'short-break': { min: 1, max: 60 },
  'long-break': { min: 1, max: 60 },
};

/** User-facing labels */
const MODE_LABELS = {
  'focus': 'Focus',
  'short-break': 'Short Break',
  'long-break': 'Long Break',
};

/** SVG Progress Ring Geometry (r = 130) */
const CIRCLE_RADIUS = 130;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

/* ==========================================================================
   2. LocalStorage Persistence Layer
   ========================================================================== */

/**
 * Validates and safely retrieves stored settings from localStorage.
 * Falls back to default values if data is missing, null, or corrupted.
 */
function loadPersistedData() {
  const defaults = {
    durations: { ...DEFAULT_DURATIONS },
    completedSessions: 0,
    theme: 'dark',
    soundEnabled: true,
    notificationEnabled: false,
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        defaults.theme = 'light';
      }
      return defaults;
    }

    const parsed = JSON.parse(raw);

    // Safeguard: Ensure parsed is a non-null, non-array object
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return defaults;
    }

    // Validate durations
    const durations = {};
    for (const [mode, defaultVal] of Object.entries(DEFAULT_DURATIONS)) {
      const storedVal = parsed.durations ? Number(parsed.durations[mode]) : null;
      const limits = DURATION_LIMITS[mode];

      if (Number.isInteger(storedVal) && storedVal >= limits.min && storedVal <= limits.max) {
        durations[mode] = storedVal;
      } else {
        durations[mode] = defaultVal;
      }
    }

    // Validate completed sessions
    const storedSessions = Number(parsed.completedSessions);
    const completedSessions = Number.isInteger(storedSessions) && storedSessions >= 0 ? storedSessions : 0;

    // Validate preferences
    const theme = parsed.theme === 'light' ? 'light' : 'dark';
    const soundEnabled = typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : true;
    const notificationEnabled = typeof parsed.notificationEnabled === 'boolean' ? parsed.notificationEnabled : false;

    return { durations, completedSessions, theme, soundEnabled, notificationEnabled };
  } catch (error) {
    console.warn('Could not read from localStorage, using defaults.', error);
    return defaults;
  }
}

/**
 * Persists the current preferences and state to localStorage.
 * 
 * @param {Object} data
 */
function savePersistedData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save to localStorage:', error);
  }
}

/* ==========================================================================
   3. Application State
   ========================================================================== */

const persisted = loadPersistedData();

const state = {
  currentMode: 'focus',
  durations: { ...persisted.durations },
  completedSessions: persisted.completedSessions,
  theme: persisted.theme,
  soundEnabled: persisted.soundEnabled,
  notificationEnabled: persisted.notificationEnabled,

  totalSeconds: persisted.durations['focus'] * 60,
  remainingSeconds: persisted.durations['focus'] * 60,
  isRunning: false,
  timerIntervalId: null,
  endTime: null,
};

/* ==========================================================================
   4. DOM Elements Cache
   ========================================================================== */

// Timer elements
const timerDisplay = document.querySelector('#timer-display');
const timerModeLabel = document.querySelector('#timer-mode-label');
const timerStatus = document.querySelector('#timer-status');
const progressRing = document.querySelector('.progress-ring__circle');

// Controls & Tabs
const startBtn = document.querySelector('#start-btn');
const pauseBtn = document.querySelector('#pause-btn');
const resetBtn = document.querySelector('#reset-btn');
const modeTabs = document.querySelectorAll('.tab-btn');

// Theme Switcher elements
const themeToggleBtn = document.querySelector('#theme-toggle-btn');
const themeIconSun = document.querySelector('#theme-icon-sun');
const themeIconMoon = document.querySelector('#theme-icon-moon');

// Session Tracker & Stats elements
const sessionCount = document.querySelector('#session-count');
const sessionDots = document.querySelector('#session-dots');
const statCompletedCount = document.querySelector('#stat-completed-count');
const statTarget = document.querySelector('#stat-target');
const statFocusTime = document.querySelector('#stat-focus-time');

// Settings Modal elements
const openSettingsBtn = document.querySelector('#open-settings-btn');
const closeSettingsBtn = document.querySelector('#close-settings-btn');
const settingsBackdrop = document.querySelector('#settings-backdrop');
const settingsForm = document.querySelector('#settings-form');
const resetDefaultsBtn = document.querySelector('#reset-defaults-btn');
const settingsError = document.querySelector('#settings-error');

const inputFocus = document.querySelector('#setting-focus');
const inputShortBreak = document.querySelector('#setting-short-break');
const inputLongBreak = document.querySelector('#setting-long-break');
const settingSound = document.querySelector('#setting-sound');
const settingNotification = document.querySelector('#setting-notification');
const notificationStatusDesc = document.querySelector('#notification-status-desc');

/* ==========================================================================
   5. Audio & Notification System (Web Audio API & Browser Notifications)
   ========================================================================== */

let audioCtx = null;

/**
 * Lazily initializes and returns the Web Audio Context after user interaction.
 */
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Plays a warm, gentle 3-tone harmonic chime (F5, A5, C6) using pure Web Audio API.
 * Requires zero audio files or network requests.
 */
function playGentleChime() {
  if (!state.soundEnabled) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // F5, A5, C6 musical notes (warm, soothing triad)
    const frequencies = [698.46, 880, 1046.5];

    frequencies.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine'; // Pure, gentle sine wave
      osc.frequency.setValueAtTime(freq, now + index * 0.12);

      // Smooth exponential volume envelope
      gain.gain.setValueAtTime(0.001, now + index * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.12, now + index * 0.12 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.12 + 1.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + index * 0.12);
      osc.stop(now + index * 0.12 + 1.25);
    });
  } catch (error) {
    console.warn('Audio playback not supported or blocked:', error);
  }
}

/**
 * Requests browser notification permission if not yet granted.
 * 
 * @returns {Promise<boolean>}
 */
async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  return false;
}

/**
 * Triggers a browser notification upon interval completion.
 * 
 * @param {string} title
 * @param {string} body
 */
function sendBrowserNotification(title, body) {
  if (!state.notificationEnabled) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: '/favicon.svg',
      });
    } catch (error) {
      console.warn('Could not display notification:', error);
    }
  }
}

/* ==========================================================================
   6. Pure Helper Functions
   ========================================================================== */

function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  const paddedMinutes = String(minutes).padStart(2, '0');
  const paddedSeconds = String(seconds).padStart(2, '0');

  return `${paddedMinutes}:${paddedSeconds}`;
}

function calculateStrokeOffset(remaining, total) {
  if (total <= 0) return 0;
  const clampedRemaining = Math.max(0, Math.min(remaining, total));
  const fractionRemaining = clampedRemaining / total;
  return CIRCLE_CIRCUMFERENCE * (1 - fractionRemaining);
}

/* ==========================================================================
   7. UI Renderers & Theme Application
   ========================================================================== */

function renderTimerDisplay() {
  if (timerDisplay) {
    timerDisplay.textContent = formatTime(state.remainingSeconds);
  }
}

function renderProgressRing() {
  if (progressRing) {
    const offset = calculateStrokeOffset(state.remainingSeconds, state.totalSeconds);
    progressRing.style.strokeDashoffset = `${offset}`;
  }
}

function renderModeLabel() {
  if (timerModeLabel) {
    timerModeLabel.textContent = MODE_LABELS[state.currentMode] || 'Focus';
  }
}

function renderStatus(message) {
  if (timerStatus) {
    timerStatus.textContent = message;
  }
}

function renderTabs() {
  modeTabs.forEach((tab) => {
    const isCurrent = tab.dataset.mode === state.currentMode;
    tab.classList.toggle('active', isCurrent);
    tab.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
  });
}

function renderSessionStats() {
  const currentCycleIndex = (state.completedSessions % 4) + 1;
  if (sessionCount) {
    sessionCount.textContent = currentCycleIndex;
  }

  if (sessionDots) {
    const dots = sessionDots.querySelectorAll('.dot');
    const filledCount = state.completedSessions % 4;
    dots.forEach((dot, index) => {
      dot.classList.toggle('filled', index < filledCount);
    });
  }

  if (statCompletedCount) {
    statCompletedCount.textContent = state.completedSessions;
  }

  if (statTarget) {
    statTarget.textContent = `${state.completedSessions}/8`;
  }

  if (statFocusTime) {
    const totalMinutes = state.completedSessions * state.durations['focus'];
    statFocusTime.textContent = totalMinutes;
  }
}

/**
 * Applies dark or light theme to document and updates toggle icon.
 * 
 * @param {'dark'|'light'} theme
 */
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  if (theme === 'dark') {
    if (themeIconSun) themeIconSun.removeAttribute('hidden');
    if (themeIconMoon) themeIconMoon.setAttribute('hidden', '');
    if (themeToggleBtn) themeToggleBtn.setAttribute('title', 'Switch to Light Mode');
  } else {
    if (themeIconSun) themeIconSun.setAttribute('hidden', '');
    if (themeIconMoon) themeIconMoon.removeAttribute('hidden');
    if (themeToggleBtn) themeToggleBtn.setAttribute('title', 'Switch to Dark Mode');
  }
}

function toggleTheme() {
  const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
  saveCurrentState();
}

function renderAll() {
  renderTimerDisplay();
  renderProgressRing();
  renderModeLabel();
  renderTabs();
  renderSessionStats();
  applyTheme(state.theme);
}

function saveCurrentState() {
  savePersistedData({
    durations: state.durations,
    completedSessions: state.completedSessions,
    theme: state.theme,
    soundEnabled: state.soundEnabled,
    notificationEnabled: state.notificationEnabled,
  });
}

/* ==========================================================================
   8. Settings Modal & Validation
   ========================================================================== */

function openSettingsModal() {
  if (!settingsBackdrop) return;

  // Populate inputs with current minutes
  if (inputFocus) inputFocus.value = state.durations['focus'];
  if (inputShortBreak) inputShortBreak.value = state.durations['short-break'];
  if (inputLongBreak) inputLongBreak.value = state.durations['long-break'];

  // Populate preference checkboxes
  if (settingSound) settingSound.checked = state.soundEnabled;
  if (settingNotification) {
    settingNotification.checked = state.notificationEnabled;
    updateNotificationHint();
  }

  hideSettingsError();
  settingsBackdrop.removeAttribute('hidden');
  if (inputFocus) inputFocus.focus();
}

function closeSettingsModal() {
  if (!settingsBackdrop) return;
  settingsBackdrop.setAttribute('hidden', '');
  hideSettingsError();
}

function updateNotificationHint() {
  if (!notificationStatusDesc) return;
  if (!('Notification' in window)) {
    notificationStatusDesc.textContent = 'Not supported in this browser';
    if (settingNotification) settingNotification.disabled = true;
  } else if (Notification.permission === 'denied') {
    notificationStatusDesc.textContent = 'Permission blocked in browser settings';
  } else if (Notification.permission === 'granted') {
    notificationStatusDesc.textContent = 'Permission granted ✓';
  } else {
    notificationStatusDesc.textContent = 'Will request permission on enable';
  }
}

function showSettingsError(message) {
  if (settingsError) {
    settingsError.textContent = message;
    settingsError.removeAttribute('hidden');
  }
}

function hideSettingsError() {
  if (settingsError) {
    settingsError.textContent = '';
    settingsError.setAttribute('hidden', '');
  }
}

async function handleSettingsSubmit(e) {
  e.preventDefault();

  const focusVal = parseInt(inputFocus.value, 10);
  const shortBreakVal = parseInt(inputShortBreak.value, 10);
  const longBreakVal = parseInt(inputLongBreak.value, 10);

  if (
    isNaN(focusVal) ||
    focusVal < DURATION_LIMITS['focus'].min ||
    focusVal > DURATION_LIMITS['focus'].max
  ) {
    showSettingsError('Focus duration must be between 1 and 90 minutes.');
    inputFocus.focus();
    return;
  }

  if (
    isNaN(shortBreakVal) ||
    shortBreakVal < DURATION_LIMITS['short-break'].min ||
    shortBreakVal > DURATION_LIMITS['short-break'].max
  ) {
    showSettingsError('Short Break duration must be between 1 and 60 minutes.');
    inputShortBreak.focus();
    return;
  }

  if (
    isNaN(longBreakVal) ||
    longBreakVal < DURATION_LIMITS['long-break'].min ||
    longBreakVal > DURATION_LIMITS['long-break'].max
  ) {
    showSettingsError('Long Break duration must be between 1 and 60 minutes.');
    inputLongBreak.focus();
    return;
  }

  // Handle notification toggle permission
  let notificationChoice = settingNotification ? settingNotification.checked : false;
  if (notificationChoice && 'Notification' in window && Notification.permission !== 'granted') {
    const granted = await requestNotificationPermission();
    if (!granted) {
      notificationChoice = false;
      if (settingNotification) settingNotification.checked = false;
    }
  }

  const oldDurationForCurrentMode = state.durations[state.currentMode];

  // Update state durations
  state.durations['focus'] = focusVal;
  state.durations['short-break'] = shortBreakVal;
  state.durations['long-break'] = longBreakVal;
  state.soundEnabled = settingSound ? settingSound.checked : true;
  state.notificationEnabled = notificationChoice;

  saveCurrentState();

  // If the timer is sitting idle (not running):
  // Only update countdown if current mode's duration actually changed,
  // or if the timer is unstarted at full duration (preserves paused countdown progress)
  const currentModeDurationChanged = oldDurationForCurrentMode !== state.durations[state.currentMode];
  if (!state.isRunning) {
    const isUnstarted = state.remainingSeconds === oldDurationForCurrentMode * 60;
    if (isUnstarted || currentModeDurationChanged) {
      state.totalSeconds = state.durations[state.currentMode] * 60;
      state.remainingSeconds = state.totalSeconds;
    }
  }

  renderAll();
  closeSettingsModal();
}

function handleResetDefaults() {
  inputFocus.value = DEFAULT_DURATIONS['focus'];
  inputShortBreak.value = DEFAULT_DURATIONS['short-break'];
  inputLongBreak.value = DEFAULT_DURATIONS['long-break'];
  if (settingSound) settingSound.checked = true;

  const oldDurationForCurrentMode = state.durations[state.currentMode];
  state.durations = { ...DEFAULT_DURATIONS };
  state.soundEnabled = true;

  saveCurrentState();
  hideSettingsError();

  const currentModeDurationChanged = oldDurationForCurrentMode !== state.durations[state.currentMode];
  if (!state.isRunning) {
    const isUnstarted = state.remainingSeconds === oldDurationForCurrentMode * 60;
    if (isUnstarted || currentModeDurationChanged) {
      state.totalSeconds = state.durations[state.currentMode] * 60;
      state.remainingSeconds = state.totalSeconds;
    }
  }

  renderAll();
  closeSettingsModal();
}

/* ==========================================================================
   9. Core Timer Actions
   ========================================================================== */

function tick() {
  const now = Date.now();
  const millisRemaining = state.endTime - now;
  const secondsLeft = Math.max(0, Math.ceil(millisRemaining / 1000));

  state.remainingSeconds = secondsLeft;
  renderTimerDisplay();
  renderProgressRing();

  if (millisRemaining <= 0) {
    completeTimer();
  }
}

function startTimer() {
  if (state.isRunning) return;

  // Initialize or resume audio context on user interaction
  getAudioContext();

  // Reset to full duration if starting after completion
  if (state.remainingSeconds <= 0) {
    state.remainingSeconds = state.totalSeconds;
    renderTimerDisplay();
    renderProgressRing();
  }

  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }

  state.isRunning = true;
  state.endTime = Date.now() + state.remainingSeconds * 1000;
  state.timerIntervalId = setInterval(tick, 250);

  renderStatus(state.currentMode === 'focus' ? 'Stay in flow...' : 'Take a breath...');
}

function pauseTimer() {
  if (!state.isRunning) return;

  state.isRunning = false;

  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }

  if (state.endTime) {
    const millisRemaining = state.endTime - Date.now();
    state.remainingSeconds = Math.max(0, Math.ceil(millisRemaining / 1000));
  }

  renderStatus('Timer paused');
  renderTimerDisplay();
  renderProgressRing();
}

function resetTimer() {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }

  state.isRunning = false;
  state.endTime = null;
  state.totalSeconds = state.durations[state.currentMode] * 60;
  state.remainingSeconds = state.totalSeconds;

  renderAll();
  renderStatus('Ready to begin');
}

function switchMode(mode) {
  if (!state.durations[mode]) return;
  if (state.currentMode === mode && !state.isRunning) return;

  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }

  state.isRunning = false;
  state.endTime = null;
  state.currentMode = mode;
  state.totalSeconds = state.durations[mode] * 60;
  state.remainingSeconds = state.totalSeconds;

  renderAll();
  renderStatus('Ready to begin');
}

function completeTimer() {
  // Idempotency check: only complete if timer was active
  if (!state.isRunning) return;

  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }

  state.isRunning = false;
  state.remainingSeconds = 0;
  state.endTime = null;

  // Play gentle completion chime
  playGentleChime();

  if (state.currentMode === 'focus') {
    state.completedSessions += 1;
    saveCurrentState();
    renderSessionStats();
    renderStatus('Focus session completed! Great job! 🎉');
    sendBrowserNotification('Focus Session Complete!', 'Time for a well-deserved break.');
  } else {
    renderStatus('Break finished! Ready to refocus? ⚡');
    sendBrowserNotification('Break Finished!', 'Ready to dive back into deep work?');
  }

  renderTimerDisplay();
  renderProgressRing();
}

/* ==========================================================================
   10. Keyboard Accessibility & Global Event Listeners
   ========================================================================== */

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;

    // 1. Never intercept if user is typing or if a button is focused
    // (allows Space to natively click buttons/tabs without hijacking)
    if (activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'BUTTON' ||
      activeEl.isContentEditable
    )) {
      return;
    }

    // 2. Escape closes settings modal
    if (e.key === 'Escape' && settingsBackdrop && !settingsBackdrop.hasAttribute('hidden')) {
      closeSettingsModal();
      return;
    }

    // 3. Ignore Space and R if settings modal is open
    if (settingsBackdrop && !settingsBackdrop.hasAttribute('hidden')) {
      return;
    }

    // 4. Space: Start / Pause Toggle
    if (e.code === 'Space') {
      e.preventDefault(); // Prevent accidental page scrolling
      if (state.isRunning) {
        pauseTimer();
      } else {
        startTimer();
      }
      return;
    }

    // 5. R / r: Reset Timer
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      resetTimer();
    }
  });
}

function setupEventListeners() {
  // Timer Controls
  if (startBtn) startBtn.addEventListener('click', startTimer);
  if (pauseBtn) pauseBtn.addEventListener('click', pauseTimer);
  if (resetBtn) resetBtn.addEventListener('click', resetTimer);

  // Mode Tabs
  modeTabs.forEach((tab) => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });

  // Theme Toggle Button
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }

  // Settings Modal Controls
  if (openSettingsBtn) openSettingsBtn.addEventListener('click', openSettingsModal);
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettingsModal);
  if (settingsForm) settingsForm.addEventListener('submit', handleSettingsSubmit);
  if (resetDefaultsBtn) resetDefaultsBtn.addEventListener('click', handleResetDefaults);

  // Close modal when clicking outside on dark backdrop
  if (settingsBackdrop) {
    settingsBackdrop.addEventListener('click', (e) => {
      if (e.target === settingsBackdrop) {
        closeSettingsModal();
      }
    });
  }

  // Notification toggle direct listener for immediate permission prompt
  if (settingNotification) {
    settingNotification.addEventListener('change', async () => {
      if (settingNotification.checked && 'Notification' in window && Notification.permission !== 'granted') {
        const granted = await requestNotificationPermission();
        if (!granted) {
          settingNotification.checked = false;
        }
        updateNotificationHint();
      }
    });
  }

  // Keyboard Shortcuts
  setupKeyboardShortcuts();
}

/* ==========================================================================
   11. Application Initialization
   ========================================================================== */

function init() {
  if (progressRing) {
    progressRing.style.strokeDasharray = `${CIRCLE_CIRCUMFERENCE}`;
    progressRing.style.strokeDashoffset = '0';
  }

  renderAll();
  renderStatus('Ready to begin');
  setupEventListeners();

  console.log('FocusFlow ready with polish enhancements! 🚀');
}

// Launch
init();
