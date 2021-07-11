import * as SmartyServer from '../smarty/smartyServer';
import { formatError } from '../utils/runner';

import {
	createConnection,
	ProposedFeatures
} from 'vscode-languageserver/node';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Based on htmlServerMain.ts
console.log = connection.console.log.bind(connection.console);
console.error = connection.console.error.bind(connection.console);

process.on('unhandledRejection', (e: any) => {
	connection.console.error(formatError(`Unhandled exception`, e));
});

SmartyServer.startServer(connection);
