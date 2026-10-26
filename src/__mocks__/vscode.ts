/**
 * Mock VS Code API for unit tests (aliased via vitest.config.ts).
 * Stateful pieces (config store, message log, command registry) expose
 * `_reset()`/`_set()` helpers prefixed with underscore — test-only API.
 */

export interface WorkspaceFolder {
	readonly uri: Uri;
	readonly name: string;
	readonly index: number;
}

// ---------------------------------------------------------------- Uri

export class Uri {
	scheme: string;
	authority: string;
	path: string;

	constructor(scheme: string, authority: string, path: string) {
		this.scheme = scheme;
		this.authority = authority;
		this.path = path;
	}

	get fsPath(): string {
		return this.path;
	}

	toString(_skipEncoding?: boolean): string {
		return `${this.scheme}://${this.authority}${this.path}`;
	}

	static file(path: string): Uri {
		return new Uri('file', '', path);
	}

	static parse(value: string): Uri {
		const match = value.match(/^(\w+):\/\/([^/]*)(.*)$/);
		if (match?.[1] && match[2] !== undefined && match[3] !== undefined) {
			return new Uri(match[1], match[2], match[3]);
		}
		return new Uri('file', '', value);
	}
}

// ---------------------------------------------------------- documents

export interface MockDocumentInit {
	readonly content: string;
	readonly languageId?: string;
	readonly fileName?: string;
}

export function _createDocument(init: MockDocumentInit) {
	const content = init.content;
	return {
		getText: (_selection?: unknown) => content,
		languageId: init.languageId ?? 'plaintext',
		fileName: init.fileName ?? '/mock/document.txt',
		uri: Uri.file(init.fileName ?? '/mock/document.txt'),
	};
}

export type MockDocument = ReturnType<typeof _createDocument>;

// ------------------------------------------------------ configuration

const configStore = new Map<string, unknown>();

export function _setConfig(key: string, value: unknown): void {
	configStore.set(key, value);
}

type ConfigListener = (event: {
	affectsConfiguration: (section: string) => boolean;
}) => void;
const configListeners: ConfigListener[] = [];

export function _fireConfigChange(section: string): void {
	for (const listener of configListeners) {
		listener({
			affectsConfiguration: (candidate: string) =>
				section === candidate || section.startsWith(`${candidate}.`),
		});
	}
}

// --------------------------------------------------------- workspace

export const workspace = {
	workspaceFolders: undefined as WorkspaceFolder[] | undefined,
	getConfiguration: (section?: string) => ({
		get: <T>(key: string, defaultValue?: T): T | undefined => {
			const full = section ? `${section}.${key}` : key;
			return configStore.has(full)
				? (configStore.get(full) as T)
				: defaultValue;
		},
		update: async (_key: string, _value: unknown, _target?: unknown) => {},
	}),
	onDidChangeConfiguration: (listener: ConfigListener) => {
		configListeners.push(listener);
		return {
			dispose: () => {
				const index = configListeners.indexOf(listener);
				if (index >= 0) configListeners.splice(index, 1);
			},
		};
	},
	openTextDocument: async (options?: { content?: string; language?: string }) =>
		_createDocument({
			content: options?.content ?? '',
			languageId: options?.language ?? 'plaintext',
		}),
};

// ------------------------------------------------------------ window

export interface ShownMessage {
	readonly kind: 'info' | 'warning' | 'error';
	readonly message: string;
	readonly items: readonly unknown[];
}

const shownMessages: ShownMessage[] = [];
let activeTextEditor:
	| { document: MockDocument; selection: unknown }
	| undefined;
let quickPickResponder: ((items: unknown[]) => unknown) | undefined;
let warningResponder: ((items: unknown[]) => unknown) | undefined;
let inputBoxResponder: (() => string | undefined) | undefined;

export function _shownMessages(): readonly ShownMessage[] {
	return shownMessages;
}

export function _setActiveEditor(document: MockDocument | undefined): void {
	activeTextEditor = document ? { document, selection: {} } : undefined;
}

export function _respondToQuickPick(
	responder: ((items: unknown[]) => unknown) | undefined,
): void {
	quickPickResponder = responder;
}

let informationResponder: ((items: unknown[]) => unknown) | undefined;

export function _respondToInformation(
	responder: ((items: unknown[]) => unknown) | undefined,
): void {
	informationResponder = responder;
}

export function _respondToWarning(
	responder: ((items: unknown[]) => unknown) | undefined,
): void {
	warningResponder = responder;
}

/** Values an input-box validator refused, in order. */
const inputBoxRejections: Array<{ value: string; message: string }> = [];

export function _inputBoxRejections(): readonly {
	value: string;
	message: string;
}[] {
	return inputBoxRejections;
}

export function _respondToInputBox(
	responder: (() => string | undefined) | undefined,
): void {
	inputBoxResponder = responder;
}

interface MockOutputChannel {
	appendLine: (line: string) => void;
	show: (preserveFocus?: boolean) => void;
	clear: () => void;
	dispose: () => void;
	_lines: string[];
	_shown: boolean;
	/** Set by dispose(), so a test can assert the channel was released. */
	_disposed: boolean;
}

const outputChannels: MockOutputChannel[] = [];

export function _outputChannels(): readonly MockOutputChannel[] {
	return outputChannels;
}

interface MockStatusBarItem {
	text: string;
	tooltip: string;
	command: unknown;
	visible: boolean;
	show(): void;
	hide(): void;
	dispose(): void;
	/** Set by dispose(), so a test can assert the item was released. */
	_disposed: boolean;
}

const statusBarItems: MockStatusBarItem[] = [];

export function _statusBarItems(): readonly MockStatusBarItem[] {
	return statusBarItems;
}

export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2 };
export const ProgressLocation = {
	SourceControl: 1,
	Window: 10,
	Notification: 15,
};

export const window = {
	get activeTextEditor() {
		return activeTextEditor;
	},
	showInformationMessage: async (message: string, ...items: unknown[]) => {
		shownMessages.push({ kind: 'info', message, items });
		// Information messages can carry action buttons and resolve to the one
		// clicked, exactly like warnings. Without a responder here a test has to
		// monkey-patch the mock to reach any of those branches.
		return informationResponder?.(items);
	},
	showWarningMessage: async (message: string, ...items: unknown[]) => {
		shownMessages.push({ kind: 'warning', message, items });
		return warningResponder?.(items);
	},
	showErrorMessage: async (message: string, ...items: unknown[]) => {
		shownMessages.push({ kind: 'error', message, items });
		return undefined;
	},
	showQuickPick: async (items: unknown[], _options?: unknown) =>
		quickPickResponder ? quickPickResponder(items) : undefined,
	showInputBox: async (options?: unknown) => {
		const value = inputBoxResponder ? inputBoxResponder() : undefined;

		// VS Code runs validateInput against what the user types and refuses to
		// accept a value the validator rejects. Ignoring it leaves the validators
		// uncovered AND lets a test hand a command a value the real UI would
		// never deliver.
		const validate = (options as { validateInput?: (v: string) => unknown })
			?.validateInput;
		if (typeof validate === 'function' && typeof value === 'string') {
			const message = validate(value);
			if (message !== undefined && message !== null && message !== '') {
				inputBoxRejections.push({ value, message: String(message) });
				return undefined;
			}
		}
		return value;
	},
	showTextDocument: async (_document: unknown, _column?: unknown) => {
		if (showDocumentError !== undefined) throw showDocumentError;
		return undefined;
	},
	withProgress: async <T>(
		_options: unknown,
		task: (progress: { report: (value: unknown) => void }) => Thenable<T>,
	): Promise<T> => task({ report: () => {} }),
	createOutputChannel: (_name: string): MockOutputChannel => {
		const lines: string[] = [];
		const channel: MockOutputChannel = {
			appendLine: (line: string) => lines.push(line),
			show: () => {
				channel._shown = true;
			},
			clear: () => {
				lines.length = 0;
			},
			dispose: () => {
				channel._disposed = true;
			},
			_lines: lines,
			_shown: false,
			_disposed: false,
		};
		outputChannels.push(channel);
		return channel;
	},
	createStatusBarItem: (
		_alignment?: unknown,
		_priority?: number,
	): MockStatusBarItem => {
		const item: MockStatusBarItem = {
			text: '',
			tooltip: '',
			command: undefined,
			visible: false,
			show(): void {
				item.visible = true;
			},
			hide(): void {
				item.visible = false;
			},
			dispose: () => {
				item._disposed = true;
			},
			_disposed: false,
		};
		statusBarItems.push(item);
		return item;
	},
};

// ---------------------------------------------------------- commands

const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();

export function _registeredCommands(): ReadonlyMap<
	string,
	(...args: unknown[]) => unknown
> {
	return registeredCommands;
}

export const commands = {
	registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
		registeredCommands.set(id, handler);
		return {
			dispose: () => {
				registeredCommands.delete(id);
			},
		};
	},
	executeCommand: async (id: string, ...args: unknown[]) => {
		const handler = registeredCommands.get(id);
		if (handler) return handler(...args);
		executedBuiltins.push({ id, args });
		return undefined;
	},
};

export const executedBuiltins: Array<{ id: string; args: unknown[] }> = [];

// --------------------------------------------------------------- env

const clipboard = { value: '' };

export const env = {
	/** What `vscode.env.appName` reports; `_setAppName` makes it another host. */
	appName: 'Visual Studio Code',
	clipboard: {
		writeText: async (text: string) => {
			if (clipboardError !== undefined) throw clipboardError;
			clipboard.value = text;
		},
		readText: async () => clipboard.value,
	},
	openExternal: async (uri: Uri) => {
		if (openExternalError !== undefined) throw openExternalError;
		openedExternal.push(uri.toString());
		return true;
	},
};

export const openedExternal: string[] = [];

// The failures the editor can hand back, so every catch around these calls
// has a test that reaches it. A path the mock cannot make fail is an
// untested path whatever the coverage figure says.
let clipboardError: unknown;
let openExternalError: unknown;
let showDocumentError: unknown;

/** Makes `env.clipboard.writeText` reject with `error`. */
export function _setClipboardError(error: unknown): void {
	clipboardError = error;
}

/** Makes `env.openExternal` reject with `error`. */
export function _setOpenExternalError(error: unknown): void {
	openExternalError = error;
}

/** Makes `window.showTextDocument` reject with `error`. */
export function _setShowDocumentError(error: unknown): void {
	showDocumentError = error;
}

export function _clipboardText(): string {
	return clipboard.value;
}

// ------------------------------------------------- extension context

export function _createExtensionContext() {
	const globalStateStore = new Map<string, unknown>();
	return {
		subscriptions: [] as Array<{ dispose(): void }>,
		globalState: {
			get: <T>(key: string, defaultValue?: T): T | undefined =>
				globalStateStore.has(key)
					? (globalStateStore.get(key) as T)
					: defaultValue,
			update: async (key: string, value: unknown) => {
				globalStateStore.set(key, value);
			},
			setKeysForSync: (_keys: readonly string[]) => {},
		},
		extension: {
			id: 'nolindnaidoo.scrape-le',
			packageJSON: { displayName: 'Scrape-LE', version: '0.0.0-test' },
		},
		asAbsolutePath: (relative: string) => `/ext/${relative}`,
	};
}

// ------------------------------------------------------ language model

/** What the provider registers, as `vscode.McpStdioServerDefinition`. */
export class McpStdioServerDefinition {
	constructor(
		readonly label: string,
		readonly command: string,
		readonly args: readonly string[],
		readonly env: Readonly<Record<string, string>>,
		readonly version: string,
	) {}
}

interface MockMcpProvider {
	id: string;
	provider: unknown;
	_disposed: boolean;
}

const mcpProviders: MockMcpProvider[] = [];

const lmApi = {
	registerMcpServerDefinitionProvider: (id: string, provider: unknown) => {
		const entry: MockMcpProvider = { id, provider, _disposed: false };
		mcpProviders.push(entry);
		return {
			dispose: () => {
				entry._disposed = true;
			},
		};
	},
};

/**
 * `vscode.lm`, present by default. A live binding: `_setLmApi(false)` is a
 * host without agent mode, which the provider must feature-detect.
 */
export let lm: typeof lmApi | undefined = lmApi;

export function _setLmApi(present: boolean): void {
	lm = present ? lmApi : undefined;
}

export function _mcpProviders(): readonly MockMcpProvider[] {
	return mcpProviders;
}

// ------------------------------------------------------- what is alive

/**
 * Everything created through this mock and not yet released: the count a
 * lifecycle test reads after deactivation, and after many runs.
 */
export function _live(): {
	statusBarItems: number;
	outputChannels: number;
	configListeners: number;
	commands: number;
	mcpProviders: number;
} {
	return {
		statusBarItems: statusBarItems.filter((item) => !item._disposed).length,
		outputChannels: outputChannels.filter((channel) => !channel._disposed)
			.length,
		configListeners: configListeners.length,
		commands: registeredCommands.size,
		mcpProviders: mcpProviders.filter((entry) => !entry._disposed).length,
	};
}

export type MockExtensionContext = ReturnType<typeof _createExtensionContext>;

/** Reset all mutable mock state between tests. */
export function _resetMockState(): void {
	env.appName = 'Visual Studio Code';
	informationResponder = undefined;
	inputBoxRejections.length = 0;
	configStore.clear();
	configListeners.length = 0;
	shownMessages.length = 0;
	executedBuiltins.length = 0;
	openedExternal.length = 0;
	registeredCommands.clear();
	outputChannels.length = 0;
	statusBarItems.length = 0;
	mcpProviders.length = 0;
	lm = lmApi;
	activeTextEditor = undefined;
	quickPickResponder = undefined;
	warningResponder = undefined;
	inputBoxResponder = undefined;
	clipboard.value = '';
	clipboardError = undefined;
	openExternalError = undefined;
	showDocumentError = undefined;
	workspace.workspaceFolders = undefined;
}

export const l10n = {
	t(message: string, ...args: unknown[]): string {
		if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
			const named = args[0] as Record<string, unknown>;
			return message.replace(/\{(\w+)\}/g, (whole, key) =>
				key in named ? String(named[key]) : whole,
			);
		}
		return message.replace(/\{(\d+)\}/g, (whole, index) => {
			const value = args[Number(index)];
			return value === undefined ? whole : String(value);
		});
	},
};

export function _setAppName(name: string): void {
	env.appName = name;
}
