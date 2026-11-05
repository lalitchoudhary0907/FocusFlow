# FocusFlow ⏱️

FocusFlow is a premium, distraction-free Pomodoro productivity timer built with pure **Vanilla HTML, CSS, and JavaScript** powered by **Vite**.

Designed with an elegant dark/light theme, ambient violet accents, and an animated circular progress ring, FocusFlow keeps you centered and productive throughout your daily workflow.

---

## 🌐 Live Demo

🚀 **Try FocusFlow Live:** [https://focus-flow0907.vercel.app](https://focus-flow0907.vercel.app)

Experience the Pomodoro timer directly in your browser — no installation or sign-up required.

---

## ✨ Features

* **Dual Visual Appearances (Obsidian & Midnight Cobalt)**:
  * **Obsidian**: Near-black graphite canvas, luminous violet progress ring, off-white digits, soft translucent surfaces, and subtle ambient glows.
  * **Midnight Cobalt**: Deep midnight navy canvas, vibrant cobalt-to-cyan progress ring, crisp white digits, dark navy statistics cards, and an eye-catching neon lime action button.
  * **Accessible Appearance Picker**: Integrated header palette button opening visual preview cards with instant keyboard navigation (Arrow keys, Enter, Esc), local persistence, and safe default fallback.
* **Offline Support (PWA Service Worker)**: Precaches the app shell and production build assets on the first online visit, enabling fully functional offline usage, timer execution, and local progress tracking.
* **Drift-Free Timestamp Countdown**: Uses wall-clock timestamps (`Date.now()`) to maintain second-accurate timing even when browser tabs are inactive or minimized.
* **Animated Circular Progress Ring**: Scalable SVG ring with mathematical progress offsets and smooth easing.
* **3 Productivity Modes**:
  * **Focus**: 25 minutes (customizable up to 90 min)
  * **Short Break**: 5 minutes (customizable up to 60 min)
  * **Long Break**: 15 minutes (customizable up to 60 min)
* **Customizable Durations & Settings**: Clean settings panel to tailor intervals to your personal rhythm, complete with input validation.
* **Session & Metric Tracking**:
  * Visual 4-session cycle progress dots.
  * Total daily intervals completed (`/8`).
  * Total focus minutes calculated automatically.
  * Consecutive-day streak engine.
* **Local Data Persistence**: Saves your durations, preferences, appearance, and completed sessions across reloads using `localStorage`. No login, backend, or cloud database required.
* **Dark / Light Mode**: Seamless theme toggle supporting both Obsidian and Midnight Cobalt appearances in both light and dark modes.
* **Gentle Completion Chime**: Soothing 3-tone harmonic chime synthesized on the fly using the browser's native **Web Audio API** (requires zero external audio files or network bandwidth).
* **Optional Desktop Notifications**: Opt-in browser notifications to alert you when focus sessions or breaks finish.
* **Keyboard Shortcuts**: Start, pause, or reset without taking your hands off the keyboard.
* **Accessibility**: Fully responsive layout, high-contrast `:focus-visible` focus rings, and full compliance with `prefers-reduced-motion`.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action | Note |
| :--- | :--- | :--- |
| <kbd>Space</kbd> | Start / Pause | Active across page (ignored while typing or focusing buttons) |
| <kbd>R</kbd> | Reset Timer | Resets countdown to active mode's duration |
| <kbd>Esc</kbd> | Close Modal | Closes active settings or appearance picker modal |

---

## 🛠️ Tech Stack

* **Markup**: Semantic HTML5 with ARIA accessibility roles
* **Styling**: Vanilla CSS3 (Custom properties, CSS Grid, Flexbox, `aspect-ratio`, `clamp()`)
* **Logic**: Vanilla JavaScript (ES Modules, Web Audio API, Web Notifications API, `localStorage`)
* **Tooling**: [Vite](https://vite.dev/) (Lightning-fast dev server and optimized production bundler)
* **Testing**: Native Node.js test runner (`tests/audit.test.mjs`)

---

## 📁 Project Structure

```text
focusflow/
├── public/
│   ├── favicon.svg           # Scalable SVG brand icon
│   ├── icon-192.png          # 192x192 PWA app icon
│   ├── icon-512.png          # 512x512 PWA app icon
│   ├── apple-touch-icon.png  # Apple touch icon for iOS
│   └── manifest.json         # Web App Manifest (standalone configuration)
├── src/
│   ├── main.js               # Timer engine, UI orchestration & shortcuts
│   ├── stats.js              # Streak calculation, daily/lifetime tracking & storage
│   └── style.css             # Theme tokens, layout, typography & animations
├── tests/
│   └── audit.test.mjs        # Automated test suite (9 verification checks)
├── index.html                # Semantic entry page with manifest link
├── package.json              # Scripts & devDependency (Vite)
├── .gitignore                # Git exclusions (node_modules, dist, secrets)
└── README.md                 # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites

* [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
* `npm` (packaged with Node.js)

### Installation

1. Clone or download the repository:
   ```bash
   git clone https://github.com/lalitchoudhary0907/FocusFlow
   cd focusflow
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the local development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

---

## 🧪 Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts Vite local development server with hot-reload |
| `npm test` | Runs the automated audit test suite |
| `npm run build` | Compiles and optimizes assets into the `dist/` directory |
| `npm run preview` | Previews the production build locally |

---

## ☁️ Deploying to Vercel

FocusFlow is fully configured for instant, zero-config deployment on [Vercel](https://vercel.com):

### Option 1: Deploy with Git (Recommended)

1. Push your repository to GitHub.
2. In the [Vercel Dashboard](https://vercel.com/new), click **Add New...** $\rightarrow$ **Project**.
3. Import your `focusflow` repository.
4. Vercel automatically detects the **Vite** framework preset:
   * **Build Command**: `npm run build`
   * **Output Directory**: `dist`
   * **Install Command**: `npm install`
5. Click **Deploy**. Your site will be live within seconds!

### Option 2: Deploy with Vercel CLI

```bash
npm install -g vercel
vercel
```

---

## 🔒 Privacy & Data Storage

* FocusFlow is 100% client-side.
* All timer durations, completed session statistics, theme preferences, and sound toggles are stored locally in your browser via `window.localStorage`.
* No telemetry, cookies, analytics, or third-party tracking scripts are included.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
