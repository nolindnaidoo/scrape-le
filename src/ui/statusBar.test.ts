import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
	_createExtensionContext,
	_fireConfigChange,
	_resetMockState,
	_setConfig,
	_statusBarItems,
} from '../__mocks__/vscode';
import { createStatusBar } from './statusBar';

function makeContext(): vscode.ExtensionContext {
	return _createExtensionContext() as unknown as vscode.ExtensionContext;
}

describe('createStatusBar', () => {
	beforeEach(() => {
		_resetMockState();
	});

	it('shows the idle item when enabled (default)', () => {
		createStatusBar(makeContext());

		const item = _statusBarItems()[0];
		expect(item?.visible).toBe(true);
		expect(item?.text).toBe('$(globe) Scrape-LE');
		expect(item?.command).toBe('scrape-le.checkUrl');
	});

	it('stays hidden when statusBar.enabled is false', () => {
		_setConfig('scrape-le.statusBar.enabled', false);
		createStatusBar(makeContext());

		expect(_statusBarItems()[0]?.visible).toBe(false);
	});

	it('show() updates text but never surfaces a disabled item', () => {
		_setConfig('scrape-le.statusBar.enabled', false);
		const statusBar = createStatusBar(makeContext());

		statusBar.show('$(sync~spin) Checking...', 'busy');

		const item = _statusBarItems()[0];
		expect(item?.text).toBe('$(sync~spin) Checking...');
		expect(item?.visible).toBe(false);
	});

	it('follows the setting live via onDidChangeConfiguration', () => {
		createStatusBar(makeContext());
		const item = _statusBarItems()[0];
		expect(item?.visible).toBe(true);

		_setConfig('scrape-le.statusBar.enabled', false);
		_fireConfigChange('scrape-le.statusBar.enabled');
		expect(item?.visible).toBe(false);

		_setConfig('scrape-le.statusBar.enabled', true);
		_fireConfigChange('scrape-le.statusBar.enabled');
		expect(item?.visible).toBe(true);
	});

	it('hide() and dispose() pass through', () => {
		const statusBar = createStatusBar(makeContext());
		statusBar.hide();
		expect(_statusBarItems()[0]?.visible).toBe(false);
		statusBar.dispose();
		expect(_statusBarItems()[0]?._disposed).toBe(true);
	});
});

describe('the idle reset', () => {
	beforeEach(() => {
		_resetMockState();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('restores the idle text and tooltip after the delay', () => {
		const statusBar = createStatusBar(makeContext());
		statusBar.show('$(check) Reachable (42ms)', 'Example - HTTP 200');
		statusBar.resetAfter(5000);

		vi.advanceTimersByTime(4999);
		expect(_statusBarItems()[0]?.text).toBe('$(check) Reachable (42ms)');
		vi.advanceTimersByTime(1);
		expect(_statusBarItems()[0]?.text).toBe('$(globe) Scrape-LE');
		expect(_statusBarItems()[0]?.tooltip).toBe(
			'Click to check URL scrapeability',
		);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('is cancelled by a later show, so a run started in the cooldown is not reset under it', () => {
		const statusBar = createStatusBar(makeContext());
		statusBar.show('$(check) Reachable (42ms)');
		statusBar.resetAfter(5000);

		vi.advanceTimersByTime(3000);
		statusBar.show('$(sync~spin) Checking...', 'busy');
		vi.advanceTimersByTime(5000);
		expect(_statusBarItems()[0]?.text).toBe('$(sync~spin) Checking...');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('keeps one pending reset: a later reset replaces the earlier one', () => {
		const statusBar = createStatusBar(makeContext());
		statusBar.show('first');
		statusBar.resetAfter(5000);
		vi.advanceTimersByTime(3000);
		statusBar.show('second');
		statusBar.resetAfter(5000);

		vi.advanceTimersByTime(2000);
		expect(_statusBarItems()[0]?.text).toBe('second');
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(3000);
		expect(_statusBarItems()[0]?.text).toBe('$(globe) Scrape-LE');
	});

	it('is cancelled by dispose, so nothing runs after it', () => {
		const statusBar = createStatusBar(makeContext());
		statusBar.show('busy');
		statusBar.resetAfter(5000);
		statusBar.dispose();

		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(5000);
		expect(_statusBarItems()[0]?.text).toBe('busy');
	});
});
