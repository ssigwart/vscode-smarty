import * as path from 'path';
import { workspace, ExtensionContext, window } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

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
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
