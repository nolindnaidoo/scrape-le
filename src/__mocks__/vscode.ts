/**
 * Mock for VS Code API in tests
 */

export const window = {
	createOutputChannel: () => ({
		appendLine: () => {},
		show: () => {},
		clear: () => {},
		dispose: () => {},
	}),
	createStatusBarItem: () => ({
		text: '',
		tooltip: '',
		command: '',
		show: () => {},
		hide: () => {},
		dispose: () => {},
	}),
	showInformationMessage: () => Promise.resolve(),
	showWarningMessage: () => Promise.resolve(),
	showErrorMessage: () => Promise.resolve(),
	showInputBox: () => Promise.resolve(''),
	withProgress: (
		_options: unknown,
		task: (progress: { report: (value: unknown) => void }) => unknown,
	) => task({ report: () => {} }),
	activeTextEditor: undefined,
};

export const workspace = {
	getConfiguration: () => ({
		get: () => undefined,
	}),
	workspaceFolders: [],
};

export const commands = {
	registerCommand: () => ({ dispose: () => {} }),
	executeCommand: () => Promise.resolve(),
};

export const Uri = {
	file: (path: string) => ({ fsPath: path }),
	parse: (path: string) => ({ fsPath: path }),
};

export const StatusBarAlignment = {
	Left: 1,
	Right: 2,
};

export const ProgressLocation = {
	Notification: 15,
	SourceControl: 1,
	Window: 10,
};

export const ExtensionContext = class {
	subscriptions: { dispose: () => void }[] = [];
};
