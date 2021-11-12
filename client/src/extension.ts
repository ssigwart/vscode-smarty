import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { workspace, ExtensionContext, window } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

/** Templates base folder */
let templatesBaseDir: string|undefined;

export function activate(context: ExtensionContext) {
	// The server is implemented in node
	let serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'html-language-features', 'smarty', 'server.js')
	);

	// Set up exec options
	let initializationOptions = {
		storageDir: context.storageUri.scheme === "file" ? context.storageUri.path : null
	};

	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	let debugOptions = {
		execArgv: ['--nolazy', '--inspect=6009']
	};

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: {
			module: serverModule,
			transport: TransportKind.ipc
		},
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for TPL files
		documentSelector: [
			{ scheme: 'file', language: 'smarty' },
			{ scheme: 'untitled', language: 'smarty' }
		],
		initializationOptions: initializationOptions,
		synchronize: {
			// Watch for plugin directories
			fileEvents: workspace.createFileSystemWatcher('**/*.php')
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'smarty',
		'Smarty Language Server',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();

	// Set up PHP document hints
	setUpTemplatesBaseFolder();
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders((e: vscode.WorkspaceFoldersChangeEvent): void => {
		setUpTemplatesBaseFolder();
	}));
	context.subscriptions.push(vscode.languages.registerDocumentLinkProvider('php', {
		provideDocumentLinks: async (doc: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentLink[]> => {
			let links: vscode.DocumentLink[] = [];
			if (vscode.workspace.workspaceFolders && templatesBaseDir !== undefined)
			{
				for (let lineIdx = 0; lineIdx < doc.lineCount; lineIdx++)
				{
					const line = doc.lineAt(lineIdx);
					let pos: number|undefined;
					while ((pos = line.text.indexOf(".tpl", pos)) !== -1)
					{
						pos += 3; // End of .tpl
						const nextChar = line.text.substring(pos + 1, pos + 2);
						if (nextChar === '\'' || nextChar === '"')
						{
							const startPos = line.text.lastIndexOf(nextChar, pos);
							if (startPos !== -1)
							{
								const range = new vscode.Range(lineIdx, startPos + 1, lineIdx, pos + 1);
								const file = templatesBaseDir + line.text.substring(startPos + 1, pos + 1);
								links.push({
									range: range,
									target: vscode.Uri.file(file)
								});
							}
						}
					}
				}
			}
			return links;
		}
	}));
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

/**
 * Set up templates base folder
 */
async function setUpTemplatesBaseFolder(): Promise<void>
{
	templatesBaseDir = undefined;
	let wsPaths = vscode.workspace.workspaceFolders.map((folder: vscode.WorkspaceFolder) => folder.uri.fsPath);
	for (let depthLeft = 3; depthLeft > 0 && templatesBaseDir === undefined; depthLeft--)
	{
		let pathDirs = await Promise.all(wsPaths.map((path: string) => fs.promises.readdir(path, { withFileTypes: true})));
		let newPaths: string[] = [];
		for (let wsPath of wsPaths)
		{
			let dirs = pathDirs.shift();
			if (dirs !== undefined)
			{
				for (const dir of dirs)
				{
					if (dir.isDirectory())
					{
						const dirPath = wsPath + path.sep + dir.name;
						if (dir.name === "templates")
						{
							templatesBaseDir = dirPath + path.sep;
							break;
						}
						else
							newPaths.push(dirPath);
					}
				}
			}
		}
		wsPaths = newPaths;
	}
}
