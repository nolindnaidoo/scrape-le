"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("node:assert"));
const vscode = __importStar(require("vscode"));
const EXTENSION_ID = 'nolindnaidoo.scrape-le';
describe('Scrape-LE integration', function () {
    this.timeout(30_000);
    it('activates', async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `extension ${EXTENSION_ID} not found`);
        await extension.activate();
        assert.strictEqual(extension.isActive, true);
    });
    it('registers every declared command', async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        await extension?.activate();
        const commands = await vscode.commands.getCommands(true);
        for (const id of [
            'scrape-le.checkUrl',
            'scrape-le.checkSelection',
            'scrape-le.setup',
            'scrape-le.openSettings',
            'scrape-le.help',
        ]) {
            assert.ok(commands.includes(id), `missing command: ${id}`);
        }
    });
    it('help command opens the help document end to end', async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        await extension?.activate();
        await vscode.commands.executeCommand('scrape-le.help');
        const helpDoc = vscode.workspace.textDocuments.find((doc) => doc.languageId === 'markdown' &&
            doc.getText().includes('# Scrape-LE Help & Troubleshooting'));
        assert.ok(helpDoc, 'help document not opened');
        // documents only real features
        assert.ok(!helpDoc.getText().includes('Export Results'));
    });
    it('checkSelection without an editor completes without throwing', async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await vscode.commands.executeCommand('scrape-le.checkSelection');
    });
    it('openSettings executes without throwing', async () => {
        await vscode.commands.executeCommand('scrape-le.openSettings');
    });
});
