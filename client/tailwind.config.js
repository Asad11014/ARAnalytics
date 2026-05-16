/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary:  { DEFAULT: '#1f22ac', hover: '#2529c9', light: 'rgba(31,34,172,0.08)' },
        gold:     '#c79a51',
        danger:   '#e03355',
        success:  '#16a34a',
        warning:  '#c79a51',
        // neutral surface palette
        brand: {
          bg:       '#f5f6fa',
          surface:  '#ffffff',
          surface2: '#eef0f7',
          border:   '#d8dbe8',
        },
        ink: {
          DEFAULT: '#1a1c2e',
          muted:   '#6b7280',
          dim:     '#b0b5c8',
        },
      },
      fontFamily: {
        sans: ['Syne', 'sans-serif'],
        mono: ['"DM Mono"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        card: '0 1px 4px rgba(31,34,172,0.06), 0 0 0 1px #d8dbe8',
        'card-hover': '0 4px 16px rgba(31,34,172,0.10), 0 0 0 1px #d8dbe8',
        modal: '0 8px 40px rgba(31,34,172,0.14)',
      }
    },
  },
  plugins: [],
}
