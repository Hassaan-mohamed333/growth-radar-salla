import type { Config } from 'tailwindcss';

// Colours are CSS variables (see globals.css) so light/dark/system switching needs no JS and no inline script.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), 'surface-2': v('surface-2'), border: v('border'),
        fg: v('fg'), muted: v('muted'), brand: v('brand'), 'brand-fg': v('brand-fg'),
        good: v('good'), warn: v('warn'), bad: v('bad'), info: v('info'),
      },
      fontFamily: { sans: ['var(--font-sans)', 'system-ui', 'sans-serif'] },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
    },
  },
  plugins: [],
} satisfies Config;
