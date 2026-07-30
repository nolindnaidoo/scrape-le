/**
 * Tests for error handling utilities
 */
import { describe, expect, it } from 'vitest';
import {
	extractErrorMessage,
	formatErrorForUser,
	isNetworkError,
	isTimeoutError,
	sanitizeErrorMessage,
} from './errorHandling';

describe('Error Handling', () => {
	describe('extractErrorMessage', () => {
		it('should extract message from Error objects', () => {
			const error = new Error('Test error');
			expect(extractErrorMessage(error)).toBe('Test error');
		});

		it('should handle string errors', () => {
			expect(extractErrorMessage('String error')).toBe('String error');
		});

		it('should handle unknown error types', () => {
			expect(extractErrorMessage(null)).toBe('An unknown error occurred');
			expect(extractErrorMessage(undefined)).toBe('An unknown error occurred');
			expect(extractErrorMessage(123)).toBe('An unknown error occurred');
		});
	});

	describe('isTimeoutError', () => {
		it('should detect timeout errors', () => {
			expect(isTimeoutError(new Error('Request timed out'))).toBe(true);
			expect(isTimeoutError(new Error('Navigation timeout'))).toBe(true);
			expect(isTimeoutError('Timeout exceeded')).toBe(true);
		});

		it('should not detect non-timeout errors', () => {
			expect(isTimeoutError(new Error('Network error'))).toBe(false);
			expect(isTimeoutError('Something else')).toBe(false);
		});
	});

	describe('isNetworkError', () => {
		it('should detect network errors', () => {
			expect(isNetworkError(new Error('net::ERR_CONNECTION_REFUSED'))).toBe(
				true,
			);
			expect(isNetworkError(new Error('Network request failed'))).toBe(true);
			expect(isNetworkError('ENOTFOUND example.com')).toBe(true);
			expect(isNetworkError('ECONNREFUSED')).toBe(true);
		});

		it('should not detect non-network errors', () => {
			expect(isNetworkError(new Error('Something else'))).toBe(false);
			expect(isNetworkError('Timeout')).toBe(false);
		});
	});

	describe('formatErrorForUser', () => {
		it('should format timeout errors with emoji', () => {
			const formatted = formatErrorForUser(new Error('Timeout exceeded'));
			expect(formatted).toContain('⏱️');
			expect(formatted).toContain('Timeout');
		});

		it('should format network errors with emoji', () => {
			const formatted = formatErrorForUser(new Error('Network error'));
			expect(formatted).toContain('🔌');
			expect(formatted).toContain('Network error');
		});

		it('should format generic errors', () => {
			const formatted = formatErrorForUser(new Error('Generic error'));
			expect(formatted).toContain('❌');
			expect(formatted).toContain('Generic error');
		});

		it('should sanitize user paths in formatted errors', () => {
			const formatted = formatErrorForUser(
				new Error('ENOENT /Users/jane/project/file.txt'),
			);
			expect(formatted).toContain('/Users/***/');
			expect(formatted).not.toContain('jane');
		});
	});

	describe('sanitizeErrorMessage', () => {
		it('redacts macOS, Linux and Windows user directories', () => {
			expect(sanitizeErrorMessage('/Users/jane/x failed')).toBe(
				'/Users/***/x failed',
			);
			expect(sanitizeErrorMessage('/home/jane/x failed')).toBe(
				'/home/***/x failed',
			);
			expect(sanitizeErrorMessage('C:\\Users\\jane\\x failed')).toBe(
				'C:\\Users\\***\\x failed',
			);
		});

		it('redacts credential-shaped fragments', () => {
			expect(sanitizeErrorMessage('auth password=hunter2 rejected')).toBe(
				'auth password=*** rejected',
			);
			expect(sanitizeErrorMessage('token: abc123')).toBe('token=***');
			expect(sanitizeErrorMessage('apikey=secret')).toBe('apikey=***');
		});

		it('leaves clean messages untouched', () => {
			expect(sanitizeErrorMessage('net::ERR_CONNECTION_REFUSED')).toBe(
				'net::ERR_CONNECTION_REFUSED',
			);
		});
	});
});
