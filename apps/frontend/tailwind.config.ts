import type { Config } from 'tailwindcss';

// RTL: the document is `dir="rtl"`. Prefer logical utilities (ms-*, me-*, ps-*, pe-*,
// start-*, end-*, text-start, text-end) over left/right so layouts mirror correctly.
// Use `rtl:` / `ltr:` variants only for things that must differ per direction (e.g. icons).
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-arabic)', 'system-ui', 'sans-serif'],
      },
      colors: {
        radar: {
          50: '#effcf6',
          500: '#12b76a',
          600: '#0e9f5c',
          900: '#0b3b27',
        },
      },
    },
  },
  plugins: [],
};

export default config;
