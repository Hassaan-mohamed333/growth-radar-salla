import type { Config } from 'tailwindcss';

// RTL: the document is `dir="rtl"`. Prefer logical utilities (ms-*, me-*, ps-*, pe-*,
// start-*, end-*, text-start, text-end) over left/right so layouts mirror correctly.
// Use `rtl:` / `ltr:` variants only for things that must differ per direction (e.g. icons).
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Cairo is self-hosted via @font-face in app/globals.css.
        sans: ['Cairo', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Brand scale, darkest to lightest. Text on white needs `dark` or `darkest`;
        // `main` and `light` are for borders, accents and fills, not text.
        brand: {
          darkest: '#03045e',
          dark: '#0077b6',
          main: '#00b4d8',
          light: '#90e0ef',
          lightest: '#caf0f8',
        },
      },
    },
  },
  plugins: [],
};

export default config;
