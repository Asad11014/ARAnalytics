/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Premium Fulfilment brand: deep navy + gold
        primary:  { DEFAULT: '#2D4270', hover: '#3a5288', light: 'rgba(45,66,112,0.08)' },
        gold:     { DEFAULT: '#c9a24b', hover: '#b88f3a' },
        // navy palette for the sidebar
        navy: {
          DEFAULT: '#2D4270',
          dark:    '#223257',
          light:   '#3a5288',
        },
        danger:   '#e03355',
        success:  '#16a34a',
        warning:  '#c9a24b',
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
        sans: ['Montserrat', 'sans-serif'],
        mono: ['"DM Mono"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        card: '0 1px 4px rgba(45,66,112,0.06), 0 0 0 1px #d8dbe8',
        'card-hover': '0 4px 16px rgba(45,66,112,0.10), 0 0 0 1px #d8dbe8',
        modal: '0 8px 40px rgba(45,66,112,0.14)',
      }
    },
  },
  plugins: [],
}
