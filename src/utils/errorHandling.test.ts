/**
 * Tests for error handling utilities
 */
import { describe, expect, it } from 'vitest';
import {
	formatErrorForUser,
	getErrorMessage,
	isNetworkError,
	isTimeoutError,
} from './errorHandling';

describe('Error Handling', () => {
	describe('getErrorMessage', () => {
		it('should extract message from Error objects', () => {
			const error = new Error('Test error');
			expect(getErrorMessage(error)).toBe('Test error');
		});

		it('should handle string errors', () => {
			expect(getErrorMessage('String error')).toBe('String error');
		});

		it('should handle unknown error types', () => {
			expect(getErrorMessage(null)).toBe('An unknown error occurred');
			expect(getErrorMessage(undefined)).toBe('An unknown error occurred');
			expect(getErrorMessage(123)).toBe('An unknown error occurred');
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
	});
});
