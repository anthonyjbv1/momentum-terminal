/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        background:  'oklch(var(--background) / <alpha-value>)',
        foreground:  'oklch(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT:    'oklch(var(--card) / <alpha-value>)',
          foreground: 'oklch(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT:    'oklch(var(--popover) / <alpha-value>)',
          foreground: 'oklch(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT:    'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT:    'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT:    'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT:    'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT:    'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        border:  'var(--border)',
        input:   'var(--input)',
        ring:    'var(--ring)',
        // Custom tokens
        'electric-blue': 'var(--electric-blue)',
        sports:          'var(--sports)',
        geopolitical:    'var(--geopolitical)',
        // Dynamic spread tokens
        'dynamic-spread':        'var(--dynamic-spread)',
        'dynamic-spread-text':   'var(--dynamic-spread-text)',
        'dynamic-spread-bright': 'var(--dynamic-spread-bright)',
        'dynamic-spread-muted':  'var(--dynamic-spread-muted)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        'glow-green':        '0 0 12px 2px oklch(0.72 0.18 145 / 0.35)',
        'glow-blue':         '0 0 12px 2px oklch(0.65 0.22 250 / 0.35)',
        'glow-dynamic':      '0 0 16px 3px oklch(0.75 0.18 55 / 0.40)',
        'glow-sports':       '0 0 12px 2px oklch(0.72 0.18 200 / 0.35)',
        'glow-geopolitical': '0 0 12px 2px oklch(0.78 0.16 65 / 0.35)',
      },
      keyframes: {
        'dynamic-spread-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 oklch(0.75 0.18 55 / 0)' },
          '50%':      { boxShadow: '0 0 12px 2px oklch(0.75 0.18 55 / 0.25)' },
        },
      },
      animation: {
        'dynamic-spread-pulse': 'dynamic-spread-pulse 3s ease-in-out infinite',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/container-queries'),
  ],
};
