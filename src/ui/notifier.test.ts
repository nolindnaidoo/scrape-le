import { beforeEach, describe, expect, it } from 'vitest';
import {
	_resetMockState,
	_setConfig,
	_shownMessages,
} from '../__mocks__/vscode';
import { createNotifier } from './notifier';

describe('createNotifier', () => {
	beforeEach(() => {
		_resetMockState();
	});

	it("level 'all' shows info, warnings and errors", () => {
		_setConfig('scrape-le.notificationsLevel', 'all');
		const notifier = createNotifier();

		notifier.info('i');
		notifier.warn('w');
		notifier.error('e');

		expect(_shownMessages().map((m) => m.kind)).toEqual([
			'info',
			'warning',
			'error',
		]);
	});

	it("level 'important' hides info", () => {
		_setConfig('scrape-le.notificationsLevel', 'important');
		const notifier = createNotifier();

		notifier.info('i');
		notifier.warn('w');
		notifier.error('e');

		expect(_shownMessages().map((m) => m.kind)).toEqual(['warning', 'error']);
	});

	it("level 'silent' still shows errors", () => {
		_setConfig('scrape-le.notificationsLevel', 'silent');
		const notifier = createNotifier();

		notifier.info('i');
		notifier.warn('w');
		notifier.error('e');

		expect(_shownMessages().map((m) => m.kind)).toEqual(['error']);
	});

	it('re-reads the level on every call — no reload needed', () => {
		_setConfig('scrape-le.notificationsLevel', 'silent');
		const notifier = createNotifier();

		notifier.warn('hidden');
		_setConfig('scrape-le.notificationsLevel', 'all');
		notifier.warn('visible');

		expect(_shownMessages().map((m) => m.message)).toEqual(['visible']);
	});

	it('defaults to important when nothing is configured', () => {
		const notifier = createNotifier();

		notifier.info('i');
		notifier.warn('w');

		expect(_shownMessages().map((m) => m.kind)).toEqual(['warning']);
	});
});
