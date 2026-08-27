/*
 * The lint rules this repository actually enforces.
 *
 * Deliberately small. A large rule set that nobody runs is worth nothing; this
 * one catches the mistakes that survive review — an import left behind by a
 * refactor, a variable that is now unused, a promise nobody awaited — and stays
 * quiet about style, which Prettier-shaped arguments consume without changing
 * what the software does.
 *
 * JSX is parsed but not rule-checked: `eslint-plugin-react` does not yet support
 * ESLint 10. `no-unused-vars` is configured to understand JSX component
 * references, which is the one thing that would otherwise produce false alarms.
 */
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

/** Anything generated, vendored, or byte-exact input that must not be reformatted. */
const IGNORED = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.astro/**',
  'artifacts/**',
  'data/**',
  '_source/**',
  // The site's own scripts ship to the browser as authored: the fidelity check
  // compares them byte for byte, so they are not ours to tidy.
  'apps/web/public/js/**',
];

const SHARED_RULES = {
  'no-unused-vars': ['error', {
    args: 'after-used',
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrors: 'none',
    // A JSX tag is a reference to the component: without this, every imported
    // component in the CMS reads as unused.
    ignoreRestSiblings: true,
  }],
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  eqeqeq: ['error', 'smart'],
  'prefer-const': 'error',
  'no-var': 'error',
  'object-shorthand': ['error', 'properties'],
  'no-return-await': 'error',
  'require-await': 'off',
};

export default [
  { ignores: IGNORED },

  /* ── The API and the shared package: Node ──────────────────────────────── */
  {
    files: ['apps/api/**/*.js', 'packages/**/*.js', 'tools/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    ...js.configs.recommended,
    rules: { ...js.configs.recommended.rules, ...SHARED_RULES },
  },

  /* ── The CMS: browser, React, JSX ──────────────────────────────────────── */
  {
    files: ['apps/cms/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    ...js.configs.recommended,
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...SHARED_RULES,
      // Warn rather than error: the two places this repository suppresses it do
      // so deliberately, and a dependency array that is wrong in a way the rule
      // cannot see is a review question, not a build failure.
      'react-hooks/exhaustive-deps': 'warn',
      // JSX identifiers are references; ESLint's core rule cannot see that
      // without the React plugin, so unused *variables* are checked and unused
      // React imports are not flagged by name.
      'no-unused-vars': [...SHARED_RULES['no-unused-vars'].slice(0, 1), {
        ...SHARED_RULES['no-unused-vars'][1],
        varsIgnorePattern: '^(_|React$)',
      }],
    },
  },

  /* ── Command-line tools: printing is what they are for ─────────────────── */
  {
    files: ['tools/**/*.mjs', 'tests/**/*.mjs', 'apps/api/src/seed/**/*.js'],
    // The browser-automation tools run callbacks inside the page, where the DOM
    // globals are real.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-console': 'off' },
  },

  /* ── Build configuration: Node, despite living beside browser code ─────── */
  {
    files: ['**/*.config.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },

  /* ── The frontend: browser + Astro's build globals ─────────────────────── */
  {
    files: ['apps/web/src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    ...js.configs.recommended,
    rules: { ...js.configs.recommended.rules, ...SHARED_RULES },
  },
];
