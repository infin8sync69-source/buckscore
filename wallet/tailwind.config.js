/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        // Bucks brand palette — gold standard
        gold: {
          50:  '#fdf8e7',
          100: '#faefc2',
          200: '#f4d97a',
          300: '#edc030',
          400: '#d4af37',   // classical mithqal gold
          500: '#b8962e',
          600: '#9a7c24',
          700: '#7a611a',
          800: '#5c4812',
          900: '#3e300b',
        },
        night: {
          50:  '#f0f0f5',
          100: '#d6d6e8',
          200: '#acacd1',
          300: '#8282ba',
          400: '#5959a3',
          500: '#2f2f8c',
          600: '#1a1a6e',
          700: '#0f0f50',
          800: '#0a0a3a',
          900: '#050524',
          950: '#02021a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'gold-glow': '0 0 20px rgba(212, 175, 55, 0.3)',
        'gold-glow-lg': '0 0 40px rgba(212, 175, 55, 0.5)',
      },
    },
  },
  plugins: [],
};
