/**
 * FocusFlow — Statistics, Streak, and Persistence Engine
 * 
 * Pure JavaScript module handling:
 * - Local calendar date calculations
 * - Multi-day consecutive streak computation
 * - Daily vs. lifetime session tracking
 * - Duration-invariant focus minutes calculation
 * - Storage migration & schema resiliency
 * - Time formatting & SVG geometry math
 */

/* ==========================================================================
   1. Configuration & Constants
   ========================================================================== */

export const STORAGE_KEY = 'focusflow_preferences';
export const DAILY_TARGET_SESSIONS = 8;

export const DEFAULT_DURATIONS = {
  'focus': 25,
  'short-break': 5,
  'long-break': 15,
};

export const DURATION_LIMITS = {
  'focus': { min: 1, max: 90 },
  'short-break': { min: 1, max: 60 },
  'long-break': { min: 1, max: 60 },
};

export const MODE_LABELS = {
  'focus': 'Focus',
  'short-break': 'Short Break',
  'long-break': 'Long Break',
};

export const DEFAULT_APPEARANCE = 'obsidian';
export const APPEARANCES = ['obsidian', 'midnight-cobalt'];

export const CIRCLE_RADIUS = 130;
export const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

/**
 * Checks whether an active or paused focus session is currently in progress.
 * Ensures the app never force-reloads or interrupts the user during focus sessions.
 * 
 * @param {Object} state
 * @returns {boolean}
 */
export function isSessionActiveOrPaused(state) {
  if (!state) return false;
  if (state.isRunning) return true;
  if (
    state.currentMode === 'focus' &&
    state.remainingSeconds < state.totalSeconds &&
    state.remainingSeconds > 0
  ) {
    return true;
  }
  return false;
}

/* ==========================================================================
   2. Date Utilities (Local Calendar Aware)
   ========================================================================== */

/**
 * Returns a local calendar date string formatted as "YYYY-MM-DD".
 * Uses local timezone values instead of UTC to prevent premature day rollover.
 * 
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the date string for the calendar day immediately preceding the given date.
 * 
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function getYesterdayDateKey(date = new Date()) {
  const prev = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
  return getLocalDateKey(prev);
}

/* ==========================================================================
   3. Consecutive Day Streak Calculator
   ========================================================================== */

/**
 * Calculates the current unbroken streak of active focus days.
 * 
 * Rule:
 * 1. If at least one session was completed today, the streak counts today and looks back consecutively.
 * 2. If zero sessions have been completed today yet, the streak stays intact based on yesterday's streak.
 * 3. If neither today nor yesterday had any completed sessions, the streak is 0.
 * 
 * @param {Record<string, { completedSessions: number, focusMinutes: number }>} [history={}]
 * @param {Date} [referenceDate=new Date()]
 * @returns {number} Consecutive active days
 */
export function calculateStreak(history = {}, referenceDate = new Date()) {
  if (!history || typeof history !== 'object') return 0;

  const todayKey = getLocalDateKey(referenceDate);
  const todaySessions = history[todayKey]?.completedSessions || 0;

  let checkDate;
  if (todaySessions > 0) {
    checkDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  } else {
    const yesterdayDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate() - 1);
    const yesterdayKey = getLocalDateKey(yesterdayDate);
    const yesterdaySessions = history[yesterdayKey]?.completedSessions || 0;

    if (yesterdaySessions > 0) {
      checkDate = yesterdayDate;
    } else {
      return 0; // Streak broken
    }
  }

  let streak = 0;
  while (true) {
    const key = getLocalDateKey(checkDate);
    const dayRecord = history[key];
    if (dayRecord && dayRecord.completedSessions > 0) {
      streak++;
      // Move back one local calendar day
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

/* ==========================================================================
   4. Statistics Mutators & Record Keepers
   ========================================================================== */

/**
 * Records a completed focus session into statistics.
 * Accurately tracks actual focus minutes based on the duration of the completed session,
 * completely independent of any future changes to timer settings.
 * 
 * @param {Object} stats
 * @param {number} focusDurationMinutes - Duration in minutes of the completed session
 * @param {Date} [referenceDate=new Date()]
 * @returns {Object} Updated stats object
 */
export function recordCompletedFocusSession(stats, focusDurationMinutes, referenceDate = new Date()) {
  const safeMinutes = Math.max(1, Math.round(focusDurationMinutes));
  const dateKey = getLocalDateKey(referenceDate);

  if (!stats.history) {
    stats.history = {};
  }

  if (!stats.history[dateKey]) {
    stats.history[dateKey] = {
      completedSessions: 0,
      focusMinutes: 0,
    };
  }

  stats.history[dateKey].completedSessions += 1;
  stats.history[dateKey].focusMinutes += safeMinutes;

  stats.lifetimeSessions = (stats.lifetimeSessions || 0) + 1;
  stats.lifetimeFocusMinutes = (stats.lifetimeFocusMinutes || 0) + safeMinutes;

  return stats;
}

/**
 * Retrieves daily statistics for a given calendar date.
 * 
 * @param {Object} stats
 * @param {Date} [referenceDate=new Date()]
 * @returns {{ completedSessions: number, focusMinutes: number }}
 */
export function getDailyStats(stats, referenceDate = new Date()) {
  const dateKey = getLocalDateKey(referenceDate);
  const day = stats?.history?.[dateKey];
  return {
    completedSessions: day?.completedSessions || 0,
    focusMinutes: day?.focusMinutes || 0,
  };
}

/* ==========================================================================
   5. Storage Migration & Data Sanitization
   ========================================================================== */

/**
 * Sanitizes and migrates raw data from localStorage.
 * Handles:
 * - First-time visits (null / empty)
 * - Legacy data containing flat completedSessions
 * - Corrupted strings, non-objects, and invalid types
 * - Out-of-bounds duration numbers
 * 
 * @param {string|null|Object} raw
 * @param {boolean} [systemPrefersLight=false]
 * @returns {Object} Sanitized FocusFlow state schema
 */
export function migrateStorageData(raw, systemPrefersLight = false) {
  const defaultTheme = systemPrefersLight ? 'light' : 'dark';
  const defaults = {
    durations: { ...DEFAULT_DURATIONS },
    theme: defaultTheme,
    appearance: DEFAULT_APPEARANCE,
    soundEnabled: true,
    notificationEnabled: false,
    stats: {
      lifetimeSessions: 0,
      lifetimeFocusMinutes: 0,
      history: {},
    },
  };

  if (!raw) return defaults;

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return defaults;
    }

    // 1. Durations
    const durations = {};
    for (const [mode, defaultVal] of Object.entries(DEFAULT_DURATIONS)) {
      const val = parsed.durations ? Number(parsed.durations[mode]) : null;
      const limits = DURATION_LIMITS[mode];
      if (Number.isInteger(val) && val >= limits.min && val <= limits.max) {
        durations[mode] = val;
      } else {
        durations[mode] = defaultVal;
      }
    }

    // 2. Preferences
    const theme = parsed.theme === 'light' ? 'light' : 'dark';
    const appearance = APPEARANCES.includes(parsed.appearance) ? parsed.appearance : DEFAULT_APPEARANCE;
    const soundEnabled = typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : true;
    const notificationEnabled = typeof parsed.notificationEnabled === 'boolean' ? parsed.notificationEnabled : false;

    // 3. Stats & History Migration
    let stats = {
      lifetimeSessions: 0,
      lifetimeFocusMinutes: 0,
      history: {},
    };

    if (parsed.stats && typeof parsed.stats === 'object' && !Array.isArray(parsed.stats)) {
      // Modern schema
      const ls = Number(parsed.stats.lifetimeSessions);
      const lm = Number(parsed.stats.lifetimeFocusMinutes);
      stats.lifetimeSessions = Number.isInteger(ls) && ls >= 0 ? ls : 0;
      stats.lifetimeFocusMinutes = Number.isInteger(lm) && lm >= 0 ? lm : 0;

      if (parsed.stats.history && typeof parsed.stats.history === 'object' && !Array.isArray(parsed.stats.history)) {
        for (const [dateKey, dayData] of Object.entries(parsed.stats.history)) {
          if (dayData && typeof dayData === 'object' && !Array.isArray(dayData)) {
            const cs = Number(dayData.completedSessions);
            const fm = Number(dayData.focusMinutes);
            stats.history[dateKey] = {
              completedSessions: Number.isInteger(cs) && cs >= 0 ? cs : 0,
              focusMinutes: Number.isInteger(fm) && fm >= 0 ? fm : 0,
            };
          }
        }
      }
    } else if (parsed.completedSessions !== undefined) {
      // Legacy schema migration:
      // Preserve old completedSessions as a lifetime count, but DO NOT create a daily history entry
      // or infer dates/minutes from current timer settings.
      const legacySessions = Number(parsed.completedSessions);
      const validLegacySessions = Number.isInteger(legacySessions) && legacySessions >= 0 ? legacySessions : 0;

      stats.lifetimeSessions = validLegacySessions;
      stats.lifetimeFocusMinutes = 0;
      stats.history = {};
    }

    return { durations, theme, appearance, soundEnabled, notificationEnabled, stats };
  } catch (err) {
    return defaults;
  }
}

/* ==========================================================================
   6. Time Formatting & SVG Ring Geometry
   ========================================================================== */

/**
 * Converts a total number of seconds into an "MM:SS" formatted string.
 * Clamps negative numbers to "00:00".
 * 
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  const paddedMinutes = String(minutes).padStart(2, '0');
  const paddedSeconds = String(seconds).padStart(2, '0');

  return `${paddedMinutes}:${paddedSeconds}`;
}

/**
 * Calculates SVG stroke-dashoffset based on remaining time.
 * 
 * @param {number} remaining
 * @param {number} total
 * @param {number} [circumference=CIRCLE_CIRCUMFERENCE]
 * @returns {number}
 */
export function calculateStrokeOffset(remaining, total, circumference = CIRCLE_CIRCUMFERENCE) {
  if (total <= 0) return 0;
  const clampedRemaining = Math.max(0, Math.min(remaining, total));
  const fractionRemaining = clampedRemaining / total;
  return circumference * (1 - fractionRemaining);
}
