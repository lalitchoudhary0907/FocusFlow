/**
 * FocusFlow — Core Pomodoro Timer with Audio, Notifications, Themes & Shortcuts
 * 
 * Tech Stack: Vanilla JavaScript (ES Modules)
 * 
 * Polish Features:
 * - Drift-free timestamp countdown
 * - Animated SVG progress ring
 * - Real multi-day consecutive streak calculator
 * - Daily vs. lifetime session separation
 * - Duration-invariant focus minutes calculation
 * - Dynamic calendar rollover without history deletion
 * - Dark / Light theme toggle with persistence
 * - Gentle completion chime via Web Audio API (Zero audio dependencies)
 * - Optional browser notifications with permission checks
 * - Accessible keyboard shortcuts (Space to start/pause, R to reset)
 * - Motion accessibility (prefers-reduced-motion)
 */

import './style.css';
import {
  STORAGE_KEY,
  DAILY_TARGET_SESSIONS,
  DEFAULT_DURATIONS,
  DURATION_LIMITS,
  MODE_LABELS,
  CIRCLE_RADIUS,
  CIRCLE_CIRCUMFERENCE,
  getLocalDateKey,
  calculateStreak,
  recordCompletedFocusSession,
  getDailyStats,
  migrateStorageData,
  formatTime,
  calculateStrokeOffset,
  isSessionActiveOrPaused,
} from './stats.js';

/* ==========================================================================
   1. State & Storage Initialization
   ========================================================================== */

const systemPrefersLight = Boolean(
  window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
);

// Safely migrate stored data or initialize defaults
const persisted = migrateStorageData(localStorage.getItem(STORAGE_KEY), systemPrefersLight);

const state = {
  currentMode: 'focus',
  durations: { ...persisted.durations },
  theme: persisted.theme,
  soundEnabled: persisted.soundEnabled,
  notificationEnabled: persisted.notificationEnabled,
  stats: persisted.stats,
  currentDateKey: getLocalDateKey(),

  totalSeconds: persisted.durations['focus'] * 60,
  remainingSeconds: persisted.durations['focus'] * 60,
  isRunning: false,
  timerIntervalId: null,
  endTime: null,
  pendingUpdateWorker: null,
  pendingReload: false,
};

/**
 * Persists current preferences and statistics state to localStorage.
 */
function saveCurrentState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        durations: state.durations,
        theme: state.theme,
        soundEnabled: state.soundEnabled,
        notificationEnabled: state.notificationEnabled,
        stats: state.stats,
      })
    );
  } catch (error) {
    console.error('Failed to save to localStorage:', error);
  }
}

/* ==========================================================================
   2. DOM Elements Cache
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
const statStreak = document.querySelector('#stat-streak');

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
   3. Audio & Notification System (Web Audio API & Browser Notifications)
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
        icon: '/icon-192.png',
      });
    } catch (error) {
      console.warn('Could not display notification:', error);
    }
  }
}

/* ==========================================================================
   4. UI Renderers & Theme Application
   ========================================================================== */

function renderTimerDisplay() {
  if (timerDisplay) {
    timerDisplay.textContent = formatTime(state.remainingSeconds);
  }
}

function renderProgressRing() {
  if (progressRing) {
    const offset = calculateStrokeOffset(state.remainingSeconds, state.totalSeconds, CIRCLE_CIRCUMFERENCE);
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

/**
 * Updates session tracker dots, dashboard statistics, and streak.
 * Daily stats automatically reflect the current calendar day.
 */
function renderSessionStats() {
  const todayStats = getDailyStats(state.stats);
  const streak = calculateStreak(state.stats.history);

  // Cycle session (1 to 4) reflecting today's completed intervals
  const currentCycleIndex = (todayStats.completedSessions % 4) + 1;
  if (sessionCount) {
    sessionCount.textContent = currentCycleIndex;
  }

  // Visual cycle indicator dots (4 dots in the current cycle)
  if (sessionDots) {
    const dots = sessionDots.querySelectorAll('.dot');
    const filledCount = todayStats.completedSessions % 4;
    dots.forEach((dot, index) => {
      dot.classList.toggle('filled', index < filledCount);
    });
  }

  // Daily completed focus intervals card (e.g. 2/8)
  if (statCompletedCount) {
    statCompletedCount.textContent = todayStats.completedSessions;
  }

  // Header daily target badge (e.g. 2/8)
  if (statTarget) {
    statTarget.textContent = `${todayStats.completedSessions}/${DAILY_TARGET_SESSIONS}`;
  }

  // Actual minutes focused today (calculated from completed sessions)
  if (statFocusTime) {
    statFocusTime.textContent = todayStats.focusMinutes;
  }

  // Real consecutive-day streak
  if (statStreak) {
    statStreak.textContent = streak;
  }
}

/**
 * Checks if the local calendar date has rolled over since last check.
 * If a new day has arrived, refreshes daily displays while preserving history.
 */
function checkDateRollover() {
  const todayKey = getLocalDateKey();
  if (todayKey !== state.currentDateKey) {
    state.currentDateKey = todayKey;
    renderSessionStats();
    saveCurrentState();
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

/* ==========================================================================
   5. Settings Modal & Validation
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

  // Update state durations and preferences
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
   6. Core Timer Actions
   ========================================================================== */

function tick() {
  checkDateRollover();

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

  // If a background update was deferred during an active/paused session, process it now
  if (state.pendingUpdateWorker && !isSessionActiveOrPaused(state)) {
    state.pendingUpdateWorker.postMessage({ type: 'SKIP_WAITING' });
    state.pendingUpdateWorker = null;
  }
  if (state.pendingReload && !isSessionActiveOrPaused(state)) {
    state.pendingReload = false;
    window.location.reload();
  }
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
    // Record session using the actual duration in minutes of the session completed
    const sessionMinutes = state.durations['focus'];
    recordCompletedFocusSession(state.stats, sessionMinutes);
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

  // If a background update was deferred during the session, process it now that session completed
  if (state.pendingUpdateWorker && !isSessionActiveOrPaused(state)) {
    state.pendingUpdateWorker.postMessage({ type: 'SKIP_WAITING' });
    state.pendingUpdateWorker = null;
  }
  if (state.pendingReload && !isSessionActiveOrPaused(state)) {
    state.pendingReload = false;
    window.location.reload();
  }
}

/* ==========================================================================
   7. Keyboard Accessibility & Global Event Listeners
   ========================================================================== */

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;

    // Never intercept if user is typing or if a button is focused
    if (activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'BUTTON' ||
      activeEl.isContentEditable
    )) {
      return;
    }

    // Escape closes settings modal
    if (e.key === 'Escape' && settingsBackdrop && !settingsBackdrop.hasAttribute('hidden')) {
      closeSettingsModal();
      return;
    }

    // Ignore Space and R if settings modal is open
    if (settingsBackdrop && !settingsBackdrop.hasAttribute('hidden')) {
      return;
    }

    // Space: Start / Pause Toggle
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.isRunning) {
        pauseTimer();
      } else {
        startTimer();
      }
      return;
    }

    // R / r: Reset Timer
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

  // Auto-detect calendar date change when user returns to tab
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkDateRollover();
    }
  });

  window.addEventListener('focus', checkDateRollover);

  // Keyboard Shortcuts
  setupKeyboardShortcuts();
}

/* ==========================================================================
   8. Production Service Worker Registration
   ========================================================================== */

/**
 * Registers the production service worker and safely handles updates.
 * Guarantees the app never force-reloads during an active or paused focus session.
 */
function registerProductionServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Detect updates to sw.js on subsequent visits
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('FocusFlow update available.');
              if (!isSessionActiveOrPaused(state)) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              } else {
                state.pendingUpdateWorker = newWorker;
              }
            }
          });
        });
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });

    // Guard controllerchange: never reload during active/paused session
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      if (isSessionActiveOrPaused(state)) {
        state.pendingReload = true;
        return;
      }
      refreshing = true;
      window.location.reload();
    });
  });
}

/* ==========================================================================
   9. Application Initialization
   ========================================================================== */

function init() {
  if (progressRing) {
    progressRing.style.strokeDasharray = `${CIRCLE_CIRCUMFERENCE}`;
    progressRing.style.strokeDashoffset = '0';
  }

  renderAll();
  renderStatus('Ready to begin');
  setupEventListeners();
  registerProductionServiceWorker();

  console.log('FocusFlow ready with dynamic statistics & streak engine! 🎯', {
    lifetimeSessions: state.stats.lifetimeSessions,
    todaySessions: getDailyStats(state.stats).completedSessions,
    streak: calculateStreak(state.stats.history),
  });
}

// Launch
init();
