import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';

export default [
	js.configs.recommended,
	prettierConfig,
	{
		files: ['**/*.ts'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module',
				project: ['./tsconfig.json'],
			},
			globals: {
				console: 'readonly',
				process: 'readonly',
				Date: 'readonly',
				Buffer: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				setInterval: 'readonly',
				clearInterval: 'readonly',
				// Node 18+ web globals. The generated shim's /health probe calls
				// `fetch` with an `AbortSignal.timeout`, so without these the
				// template fails `pnpm lint` on its OWN scaffolded code — which is
				// exactly what happened to privatebin and filetransfer.
				fetch: 'readonly',
				AbortController: 'readonly',
				AbortSignal: 'readonly',
				URL: 'readonly',
				URLSearchParams: 'readonly',
				Request: 'readonly',
				Response: 'readonly',
				Headers: 'readonly',
				TextEncoder: 'readonly',
				TextDecoder: 'readonly',
				structuredClone: 'readonly',
			},
		},
		plugins: {
			'@typescript-eslint': tsPlugin,
		},
		rules: {
			...tsPlugin.configs.recommended.rules,
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'@typescript-eslint/explicit-function-return-type': 'off',
			'@typescript-eslint/no-explicit-any': 'warn',
			'no-console': 'off',
		},
	},
	{
		ignores: ['dist/**', 'node_modules/**', '*.config.js'],
	},
];
