import { beforeEach, describe, expect, it } from 'vitest';
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
	});
});
