/** @type {import('tailwindcss').Config} */
export default {
  // Every theme the app ships is dark, so the `dark:` utilities are not a mode
  // switch — they are the only styling. Keying them off the `dark` class (which
  // app.html sets) matches the hand-written `.dark …` rules in index.css and
  // keeps the two mechanisms from disagreeing.
  darkMode: ['selector', '.dark'],
  content: ['./index.html', './main.jsx', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // One family for the interface. Display is heavy Inter with tight
        // tracking — the type carries the hierarchy, not a second face.
        display: ['Instrument Serif', 'Iowan Old Style', 'Palatino', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        // The note itself is a reading surface, not a code pane: a system serif
        // (no download, works offline) at a comfortable measure. Interface stays
        // Inter; monospace is reserved for code the user actually typed.
        note: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        // Tighter than Tailwind's defaults: quiet corners, not pills.
        xl: '0.5rem',
        '2xl': '0.625rem',
        '3xl': '0.75rem',
      },
      colors: {
        white: '#fefcff',
        gray: {
          50: 'rgb(var(--gray-50) / <alpha-value>)',
          100: 'rgb(var(--gray-100) / <alpha-value>)',
          200: 'rgb(var(--gray-200) / <alpha-value>)',
          300: 'rgb(var(--gray-300) / <alpha-value>)',
          400: 'rgb(var(--gray-400) / <alpha-value>)',
          500: 'rgb(var(--gray-500) / <alpha-value>)',
          600: 'rgb(var(--gray-600) / <alpha-value>)',
          700: 'rgb(var(--gray-700) / <alpha-value>)',
          750: 'rgb(var(--gray-750) / <alpha-value>)',
          800: 'rgb(var(--gray-800) / <alpha-value>)',
          850: 'rgb(var(--gray-850) / <alpha-value>)',
          900: 'rgb(var(--gray-900) / <alpha-value>)',
          950: 'rgb(var(--gray-950) / <alpha-value>)',
        },
        accent: {
          50: 'rgb(var(--accent-50) / <alpha-value>)',
          100: 'rgb(var(--accent-100) / <alpha-value>)',
          200: 'rgb(var(--accent-200) / <alpha-value>)',
          300: 'rgb(var(--accent-300) / <alpha-value>)',
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-600) / <alpha-value>)',
          700: 'rgb(var(--accent-700) / <alpha-value>)',
          800: 'rgb(var(--accent-800) / <alpha-value>)',
          900: 'rgb(var(--accent-900) / <alpha-value>)',
        },
      },
      boxShadow: {
        // Two elevations, both quiet. The old scale carried tinted coloured
        // shadows (accent/success/warning) that tinted whole panels.
        soft: '0 1px 2px rgb(0 0 0 / 0.04)',
        'soft-lg': '0 2px 6px rgb(0 0 0 / 0.06)',
        'soft-xl': '0 8px 24px rgb(0 0 0 / 0.10)',
        'inner-soft': 'inset 0 1px 0 rgb(255 255 255 / 0.04)',
        accent: '0 1px 2px rgb(0 0 0 / 0.04)',
        success: '0 1px 2px rgb(0 0 0 / 0.04)',
        warning: '0 1px 2px rgb(0 0 0 / 0.04)',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
