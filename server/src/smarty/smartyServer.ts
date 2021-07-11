import { getPlugin, availablePlugins, SmartyPluginType, setUpSmartyPluginsFromConfig, reloadPluginFromFile, deletePluginFromFile, SmartyPlugin } from '../smarty/smartyPlugins';
import { smartyFunctionAttributes, smartyFunctions, smartyModifiers } from './smartyLangData';
import { extendConnectionDocumentLinks } from './smartyLinks';
import { IndexStorage } from "./indexStorage";

import { runSafe } from "../utils/runner";

import {
	RequestHandler,
	ResponseError,
	HandlerResult,
	ServerRequestHandler,
	InitializeError,
	InitializedParams,
	NotificationHandler,
	DidOpenTextDocumentParams,
	DidChangeTextDocumentParams,
	DidCloseTextDocumentParams,
	WillSaveTextDocumentParams,
	DidSaveTextDocumentParams,
	CancellationToken,
	WorkDoneProgressReporter,
	ResultProgressReporter,
	CompletionParams,
	PublishDiagnosticsParams,
	DidChangeConfigurationParams,
	DidChangeWatchedFilesParams,
	FileChangeType,
	DefinitionParams,
	Definition,
	DefinitionLink,
	Location,
	LocationLink,
	SignatureHelpParams,
	SignatureHelp,
	URI
} from 'vscode-languageserver';

import {
	Connection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	InitializeResult,
	Range,
	Position,
	CompletionList,
	TextEdit
} from 'vscode-languageserver/node';

import {
	InsertReplaceEdit
} from 'vscode-languageserver-types';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import {
	DocumentSmartyBlock,
	getDocumentSmartyInfo,
	getSmartyBlocksForPositionFromSmartyInfo,
	DocumentSmartyInfo
} from './docLangDetector';

import * as HtmlServer from '../htmlServer';
import { getNodeFSRequestService } from '../node/nodeFs';

// Create a simple text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

/** Max line length when we want to get a full line */
const maxExpectedLineLength = 9999999;

/** Index storage */
let indexStorage: IndexStorage<SmartyPlugin>|null = null;
const indexVersion = 1;

/** Get index storage */
export function getIndexStorage(): IndexStorage<SmartyPlugin>|null
{
	return indexStorage;
}

// Cached Smarty info
interface DocumentSmartyInfoCacheEntry {
	version: number;
	info: DocumentSmartyInfo
};
let docSmartyInfoCache: Map<string, DocumentSmartyInfoCacheEntry> = new Map();

/**
 * Get document Smarty info
 * 
 * @param {TextDocument} doc Document
 * 
 * @return {DocumentSmartyInfo}
 */
export function getCachedDocumentSmartyInfo(doc: TextDocument): DocumentSmartyInfo
{
	let cacheInfo = docSmartyInfoCache.get(doc.uri);
	if (cacheInfo !== undefined && cacheInfo.version >= doc.version)
		return cacheInfo.info;
	let info = getDocumentSmartyInfo(doc);
	docSmartyInfoCache.set(doc.uri, {
		version: doc.version,
		info: info
	});
	return info;
}

/**
 * Update connection initialization
 *
 * @param {Connection} connection Connection
 */
function updateConnectionInitialization(connection: Connection): void
{
	// Set up onInitialize
	let onInitializeHandler: ServerRequestHandler<InitializeParams, InitializeResult, never, InitializeError>|null = null;
	connection.onInitialize((params: InitializeParams, token: CancellationToken, workDoneProgress: WorkDoneProgressReporter, resultProgress?: ResultProgressReporter<InitializeResult>): HandlerResult<InitializeResult, InitializeError> => {
		let result: HandlerResult<InitializeResult, InitializeError>;
		if (onInitializeHandler !== null)
		{
			result = onInitializeHandler(params, token, workDoneProgress, resultProgress);
			if ("capabilities" in result)
				extendCapabilities(params, result);
			// Set up index
			if (params.initializationOptions.storageDir)
				indexStorage = new IndexStorage<SmartyPlugin>(params.initializationOptions.storageDir, indexVersion);
		}
		else
			result = new ResponseError<InitializeError>(1, "HTML onInitializeHandler is not set.");
		return result;
	});
	connection.onInitialize = function(handler: ServerRequestHandler<InitializeParams, InitializeResult, never, InitializeError>): void {
		onInitializeHandler = handler;
	};

	// Set up onInitialized
	let onInitializedHandler: NotificationHandler<InitializedParams>|null = null;
	connection.onInitialized((params: InitializedParams): void => {
		if (onInitializedHandler !== null)
			onInitializedHandler(params);
		onInitialized(connection);
	});
	connection.onInitialized = function(handler: NotificationHandler<InitializedParams>): void {
		onInitializedHandler = handler;
	};
}

/**
 * Update connection config change
 *
 * @param {Connection} connection Connection
 */
function updateConnectionConfigChange(connection: Connection): void
{
	// Set up onDidChangeConfiguration
	let onDidChangeConfigurationHandler: NotificationHandler<DidChangeConfigurationParams>|null = null;
	connection.onDidChangeConfiguration((change: DidChangeConfigurationParams): void => {
		if (onDidChangeConfigurationHandler !== null)
			onDidChangeConfigurationHandler(change);

		// Update configuration
		if (hasConfigurationCapability) {
			// Reset all cached document settings
			documentSettings.clear();
		} else {
			globalSettings = <SmartyConfigSettings>(
				(change.settings.smarty || defaultSettings)
			);
		}

		// Set up plugins
		setUpSmartyPluginsFromConfig(connection);
	});
	connection.onDidChangeConfiguration = function(handler: NotificationHandler<DidChangeConfigurationParams>): void {
		onDidChangeConfigurationHandler = handler;
	};
}

/**
 * Update connection for document.listen
 *
 * @param {Connection} connection Connection
 */
function updateConnectionForDocumentListen(connection: Connection): void
{
	// onDidOpenTextDocument
	let onDidOpenTextDocumentHandlers: NotificationHandler<DidOpenTextDocumentParams>[] = [];
	connection.onDidOpenTextDocument(function(params: DidOpenTextDocumentParams): void {
		for (let handler of onDidOpenTextDocumentHandlers)
			handler(params);
	});
	connection.onDidOpenTextDocument = function(handler: NotificationHandler<DidOpenTextDocumentParams>): void {
		onDidOpenTextDocumentHandlers.push(handler);
	};

	// onDidChangeTextDocument
	let onDidChangeTextDocumentHandlers: NotificationHandler<DidChangeTextDocumentParams>[] = [];
	connection.onDidChangeTextDocument(function(params: DidChangeTextDocumentParams): void {
		for (let handler of onDidChangeTextDocumentHandlers)
			handler(params);
	});
	connection.onDidChangeTextDocument = function(handler: NotificationHandler<DidChangeTextDocumentParams>): void {
		onDidChangeTextDocumentHandlers.push(handler);
	};

	// onDidCloseTextDocument
	let onDidCloseTextDocumentHandlers: NotificationHandler<DidCloseTextDocumentParams>[] = [];
	connection.onDidCloseTextDocument(function(params: DidCloseTextDocumentParams): void {
		for (let handler of onDidCloseTextDocumentHandlers)
			handler(params);

			// Clean up cache
			docSmartyInfoCache.delete(params.textDocument.uri);
	});
	connection.onDidCloseTextDocument = function(handler: NotificationHandler<DidCloseTextDocumentParams>): void {
		onDidCloseTextDocumentHandlers.push(handler);
	};

	// onWillSaveTextDocument
	let onWillSaveTextDocumentHandlers: NotificationHandler<WillSaveTextDocumentParams>[] = [];
	connection.onWillSaveTextDocument(function(params: WillSaveTextDocumentParams): void {
		for (let handler of onWillSaveTextDocumentHandlers)
			handler(params);
	});
	connection.onWillSaveTextDocument = function(handler: NotificationHandler<WillSaveTextDocumentParams>): void {
		onWillSaveTextDocumentHandlers.push(handler);
	};

	// onWillSaveTextDocumentWaitUntil
	let onWillSaveTextDocumentWaitUntilHandlers: RequestHandler<WillSaveTextDocumentParams, TextEdit[] | undefined | null, void>[] = [];
	
	connection.onWillSaveTextDocumentWaitUntil(function(params: WillSaveTextDocumentParams, token: CancellationToken): HandlerResult<TextEdit[] | undefined | null, void> {
		// TODO: Should this call all handlers?
		for (let handler of onWillSaveTextDocumentWaitUntilHandlers)
			return handler(params, token);
		return null;
	});
	connection.onWillSaveTextDocumentWaitUntil = function(handler: RequestHandler<WillSaveTextDocumentParams, TextEdit[] | undefined | null, void>): void {
		onWillSaveTextDocumentWaitUntilHandlers.push(handler);
	};

	// onDidSaveTextDocument
	let onDidSaveTextDocumentHandlers: NotificationHandler<DidSaveTextDocumentParams>[] = [];
	connection.onDidSaveTextDocument(function(params: DidSaveTextDocumentParams): void {
		for (let handler of onDidSaveTextDocumentHandlers)
			handler(params);
	});
	connection.onDidSaveTextDocument = function(handler: NotificationHandler<DidSaveTextDocumentParams>): void {
		onDidSaveTextDocumentHandlers.push(handler);
	};
}

interface SmartyCursorPositionInfo
{
	name: string;
	startIdx: number;
	endIdx: number;
}

/**
 * Get Smarty plugin info from line position
 *
 * @param {string} lineText Line
 * @param {number} pos Cursor position
 * 
 * @return {SmartyCursorPositionInfo|null} Plugin info if applicable
 */
function getSmartyPluginInfoFromPos(lineText: string, pos: number): SmartyCursorPositionInfo|null
{
	let i1 = pos;
	let startChar: string|null = null;
	for (; i1 >= 0; i1--)
	{
		let c = lineText[i1];
		if (c === "{" || c === "|")
		{
			startChar = c;
			break;
		}
		else if (!/[A-Za-z0-9_]/.test(c))
			return null;
	}
	if (startChar === null)
		return null;
	let i2 = pos;
	for (; i2 < lineText.length; i2++)
	{
		let c = lineText[i2];
		if (
			c === "|" ||
			c === "}" ||
			(c === ":" && startChar === "|") ||
			((c === " " || c === "\t") && startChar === "{")
		)
		{
			return {
				name: lineText.substring(i1 + 1, i2),
				startIdx: i1 + 1,
				endIdx: i2
			};
		}
		else if (!/[A-Za-z0-9_]/.test(c))
			return null;
	}

	return null;
}

/**
 * Update onDefinition
 *
 * @param {Connection} connection Connection
 */
function updateConnectionOnDefinition(connection: Connection): void
{
	let onDefinitionHandler: ServerRequestHandler<DefinitionParams, Definition | DefinitionLink[] | undefined | null, Location[] | DefinitionLink[], void>|null = null;
	connection.onDefinition((params: DefinitionParams, token: CancellationToken, workDoneProgress: WorkDoneProgressReporter, resultProgress?: ResultProgressReporter<Definition | DefinitionLink[] | undefined | null>): HandlerResult<Definition | DefinitionLink[] | undefined | null, void> => {
		// Check if there's a smarty completion
		let currentUri = params.textDocument.uri;
		let doc = documents.get(currentUri);
 		if (doc)
		{
			// Get plugin name
			let pos = params.position;
			let lineText = doc.getText(Range.create(pos.line, 0, pos.line, maxExpectedLineLength));
			let pluginCursorInfo = getSmartyPluginInfoFromPos(lineText, pos.character);
			if (pluginCursorInfo !== null)
			{
				// Do we have the file for the plugin?
				let plugin = getPlugin(pluginCursorInfo.name);
				if (plugin !== null)
				{
					let targetUri = "file://" + plugin.path;
					let firstPos = Position.create(plugin.definitionLine || 0, 0);
					let endPos = Position.create(plugin.definitionLine || 0, maxExpectedLineLength);
					return [LocationLink.create(
						targetUri,
						Range.create(firstPos, endPos),
						Range.create(firstPos, endPos),
						Range.create(Position.create(pos.line, pluginCursorInfo.startIdx), Position.create(pos.line, pluginCursorInfo.endIdx))
					)];
				}
			}
		}

		let result = null;
		if (onDefinitionHandler !== null)
			result = onDefinitionHandler(params, token, workDoneProgress, resultProgress);
		return result;
	});
	connection.onDefinition = function(handler: ServerRequestHandler<DefinitionParams, Definition | DefinitionLink[] | undefined | null, Location[] | DefinitionLink[], void>): void
	{
		onDefinitionHandler = handler;
	}
}

/**
 * Start server
 * 
 * @param {Connection} connection Connection
 */
export function startServer(connection: Connection): void
{
	// Modify points we want to update
	updateConnectionInitialization(connection);
	updateConnectionConfigChange(connection);
	updateConnectionOnDefinition(connection);
	extendConnectionDocumentLinks(connection);
	updateConnectionForDocumentListen(connection);
	updateConnectionCompletions(connection);
	updateConnectionSignature(connection);
	updateConnectionDiagnostics(connection);

	// Make the text document manager listen on the connection
	// for open, change and close text document events
	documents.listen(connection);

	// Only keep settings for open documents
	documents.onDidClose(e => {
		documentSettings.delete(e.document.uri);
	});

	// Handle plugin file changes
	connection.onDidChangeWatchedFiles((change: DidChangeWatchedFilesParams): void => {
		for (let singleChange of change.changes)
		{
			if (singleChange.uri.startsWith("file://"))
			{
				let filePath = singleChange.uri.substring(7);
				// Removed plugin
				if (singleChange.type === FileChangeType.Deleted)
					deletePluginFromFile(filePath);
				// Updated plugin
				else
					reloadPluginFromFile(filePath);
			}
		}
	});

	// Start HTML server
	HtmlServer.startServer(connection, { file: getNodeFSRequestService() });
}

/**
 * Get document
 */
export function getDocument(uri: string): TextDocument|undefined
{
	return documents.get(uri);
}

/**
 * Handle onInitialized event
 */
export function onInitialized(connection: Connection): void
{
	if (hasConfigurationCapability)
	{
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability)
	{
		// TODO: Handle workspace folder changes
		/*
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
		*/
	}

	// Set up plugins
	setUpSmartyPluginsFromConfig(connection);
}

/** Smarty config settings */
export interface SmartyConfigSettings {
	maxNumberOfDiagnosticMsgs: number;
	pluginDirs: string[];
	xssExemptRegularExpressions: string[];
	xssExemptModifiers: string[];
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
const defaultSettings: SmartyConfigSettings = {
	maxNumberOfDiagnosticMsgs: 1000,
	pluginDirs: [],
	xssExemptRegularExpressions: [],
	xssExemptModifiers: []
};
let globalSettings: SmartyConfigSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<SmartyConfigSettings>> = new Map();

export let hasConfigurationCapability = false;
export let hasWorkspaceFolderCapability = false;

/**
 * Extend server capabilities info
 */
function extendCapabilities(params: InitializeParams, result: InitializeResult): InitializeResult
{
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);

	// Update trigger characters
	if (result.capabilities.completionProvider)
		result.capabilities.completionProvider.triggerCharacters?.push("$", "|", " ", "{");

	// Update signature help
	if (result.capabilities.signatureHelpProvider)
	{
		if (!result.capabilities.signatureHelpProvider.triggerCharacters)
			result.capabilities.signatureHelpProvider.triggerCharacters = [];
		result.capabilities.signatureHelpProvider.triggerCharacters.push(" ", "=", ":"); // Space for block functions. Equal for if we add a parameter to an existing block function. Colon for modifiers.
	}

	// TODO: Is workspace folder capability needed?
	if (hasWorkspaceFolderCapability)
	{
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}

	return result;
}

/**
 * Get document settings
 *
 * @param {Connection} connection Connection
 * @param {string} resource Resource
 */
function getDocumentSettings(connection: Connection, resource: string): Thenable<SmartyConfigSettings>
{
	if (!hasConfigurationCapability)
		return Promise.resolve(globalSettings);
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'smarty'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

/**
 * Check if a Smarty variable tag matches XSS exceptions
 *
 * @param {string} varTag Variable tag
 * @param {string[]} exemptModifiers Exempt modifier
 *
 * @return {boolean} True if exempt
 */
function isSmartyVariableExemptFromXss(varTag: string, exemptRegularExpressions: string[], exemptModifiers:string[]): boolean
{
	let tagParts = varTag.substring(1, varTag.length - 1).split(/[|]/);
	let varPart = tagParts.shift();
	if (varPart)
	{
		for (let regexStr of exemptRegularExpressions)
		{
			let regex = new RegExp(regexStr);
			if (regex.test(varPart))
				return true;
		}
	}
	for (let tagPart of tagParts)
	{
		if (exemptModifiers.indexOf(tagPart.replace(/:.*$/, "")) !== -1)
			return true;
	}
	return false;
}

/**
 * Update connection diagnostics
 *
 * @param {Connection} connection Connection
 */
function updateConnectionDiagnostics(connection: Connection): void
{
	let realSendDiagnostics = connection.sendDiagnostics;
	connection.sendDiagnostics = function (params: PublishDiagnosticsParams): void
	{
		let document = getDocument(params.uri);
		if (document)
		{
			getTextDocumentDiagnostics(connection, document).then((smartyDiagnostics) => {
				for (let diagnostic of smartyDiagnostics)
					params.diagnostics.push(diagnostic);
				realSendDiagnostics(params);
			});
		}
		else
			realSendDiagnostics(params);
	};
}

/**
 * Get diagnostics
 *
 * @param {Connection} connection Connection
 */
async function getTextDocumentDiagnostics(connection: Connection, textDocument: TextDocument): Promise<Diagnostic[]>
{
	// Get settings
	const settings = await getDocumentSettings(connection, textDocument.uri);

	// Get literal offsets
	let smartyInfo = getCachedDocumentSmartyInfo(textDocument);
	let smartyLiteralOffsetRanges: [number, number][] = [];
	for (let smartyBlock of smartyInfo.blocks)
	{
		if (smartyBlock.blockName === "literal" && smartyBlock.endOffset)
			smartyLiteralOffsetRanges.push([smartyBlock.startOffset, smartyBlock.endOffset]);
	}
	let isInSmartyLiteral = function(offset: number): boolean
	{
		for (let range of smartyLiteralOffsetRanges)
		{
			if (offset < range[0])
				return false;
			else if (offset >= range[0] && offset <= range[1])
				return true;
		}
		return false;
	};
	let isInSmartyComment = function(offset: number): boolean
	{
		for (let range of smartyInfo.commentOffsets)
		{
			if (offset < range[0])
				return false;
			else if (offset >= range[0] && offset <= range[1])
				return true;
		}
		return false;
	};

	// Check for outputing variables that might be vulnerable to XSS
	const content = textDocument.getText();
	const regex = /{\$[^}]+}/g;
	let match: RegExpExecArray | null;
	const diagnostics: Diagnostic[] = [];
	while ((match = regex.exec(content)) && diagnostics.length < settings.maxNumberOfDiagnosticMsgs)
	{
		// Check that it's not in a Smarty comment or literal section
		if (!isInSmartyLiteral(match.index) && !isInSmartyComment(match.index))
		{
			// Check if vulnerable
			if (
				// Assume htmlspecialchars, urlencode, json_encode, number_format, and round are good
				!/\|(htmlspecialchars|urlencode|json_encode|number_format|round)\b/.test(match[0]) &&
				// Skip things ending in "Id" or "Html"
				!/\$[^|]+(_id|Id|_html|Html)(\(\))?[|}]/.test(match[0]) &&
				// Custom exemptions
				!isSmartyVariableExemptFromXss(match[0], settings.xssExemptRegularExpressions || [], settings.xssExemptModifiers || [])
			)
			{
				const diagnostic: Diagnostic = {
					severity: DiagnosticSeverity.Warning,
					range: {
						start: textDocument.positionAt(match.index),
						end: textDocument.positionAt(match.index + match[0].length)
					},
					message: match[0] + " might be vulnerable to XSS.",
					source: 'Smarty extension'
				};
				diagnostics.push(diagnostic);
			}
		}
	}

	return diagnostics;
}

/**
 * Check if a position is in a smarty block within the delimiters
 * 
 * @param {DocumentSmartyBlock} block Block
 */
function isPositionInBlockDelimiter(doc: TextDocument, pos: Position, block: DocumentSmartyBlock): boolean
{
	let offset = doc.offsetAt(pos);
	if (offset < block.startOffset)
		return false;
	let endOffset = block.endOffset || block.startOffset + 9999;
	for (let i = block.startOffset; i <= endOffset; i++)
	{
		if (i === offset)
			return true;
		let c = doc.getText(Range.create(doc.positionAt(i), doc.positionAt(i + 1)));
		if (c === "}")
			return false;
	}

	return false;
}

/**
 * Update connection completions
 *
 * @param {Connection} connection Connection
 */
function updateConnectionCompletions(connection: Connection): void
{
	// Set up onCompletion
	let onCompletionHandler: ServerRequestHandler<CompletionParams, CompletionItem[] | CompletionList | undefined | null, CompletionItem[], void>|null = null;
	connection.onCompletion((params: CompletionParams, token: CancellationToken, workDoneProgress: WorkDoneProgressReporter, resultProgress?: ResultProgressReporter<CompletionItem[]>): HandlerResult<CompletionItem[] | CompletionList | undefined | null, void> => {
		return runSafe(async () => {
			let document = getDocument(params.textDocument.uri);
			if (document)
			{
				let completionList: CompletionList = {
					isIncomplete: false,
					items: []
				};
				completionList = await getCompletions(params, document);
				if (onCompletionHandler !== null)
				{
					let htmlCompletions = await onCompletionHandler(params, token, workDoneProgress, resultProgress);
					if (htmlCompletions !== null && htmlCompletions !== undefined)
					{
						let items: CompletionItem[] = [];
						if (Array.isArray(htmlCompletions))
							items = htmlCompletions;
						else if ("items" in htmlCompletions)
						{
							items = htmlCompletions.items;
							if (htmlCompletions.isIncomplete)
								completionList.isIncomplete = true;
						}
						for (let item of items)
							completionList.items.push(item);
					}
				}
				return completionList;
			}
		}, null, `Error while computing completions for ${params.textDocument.uri}`, token);
	});
	connection.onCompletion = function(handler: ServerRequestHandler<CompletionParams, CompletionItem[] | CompletionList | undefined | null, CompletionItem[], void>): void {
		onCompletionHandler = handler;
	};
}

/**
 * Update connection signature
 *
 * @param {Connection} connection Connection
 */
function updateConnectionSignature(connection: Connection): void
{
	let onSignatureHelpHandler: ServerRequestHandler<SignatureHelpParams, SignatureHelp | undefined | null, never, void>|null = null;
	connection.onSignatureHelp((params: SignatureHelpParams, token: CancellationToken, workDoneProgress: WorkDoneProgressReporter, resultProgress?: ResultProgressReporter<SignatureHelp>): HandlerResult<SignatureHelp | undefined | null, void> => {
		return runSafe(async () => {
			let document = getDocument(params.textDocument.uri);
			if (document)
			{
				// Check for Smarty signature
				let help = await getSignature(params.position, document);
				if (help !== null)
					return help;

				// Use HTML signature
				if (onSignatureHelpHandler !== null)
					return onSignatureHelpHandler(params, token, workDoneProgress, resultProgress);
			}
			return null;
		}, null, `Error while computing signatures for ${params.textDocument.uri}`, token);
	});
	connection.onSignatureHelp = function(handler: ServerRequestHandler<SignatureHelpParams, SignatureHelp | undefined | null, never, void>): void {
		onSignatureHelpHandler = handler;
	};
}

/**
 * Get completions
 */
async function getCompletions(_textDocumentPosition: TextDocumentPositionParams, doc: TextDocument): Promise<CompletionList>
{
	let completionSuggestions: CompletionItem[] = [];
	let pos = _textDocumentPosition.position;
	let lineStartPos = Position.create(pos.line, 0);
	let range = Range.create(lineStartPos, pos);
	let lineText = doc.getText(range);
	let offset = doc.offsetAt(pos);

	// Get Smarty blocks
	let smartyInfo = getCachedDocumentSmartyInfo(doc);
	// Check if we're in a literal
	let inSmartyLiteral = false;
	let smartyCurrentBlocks = getSmartyBlocksForPositionFromSmartyInfo(offset, smartyInfo, true);
	let lastSmartyBlock: DocumentSmartyBlock|null = null;
	if (smartyCurrentBlocks.length > 0)
	{
		lastSmartyBlock = smartyCurrentBlocks[smartyCurrentBlocks.length - 1];
		if (lastSmartyBlock.blockName === "literal" && lastSmartyBlock.startOffset !== offset)
			inSmartyLiteral = true;
	}

	// Functions
	if (!inSmartyLiteral && lineText.substr(-1, 1) === '{')
	{
		let dataIdx = 0;
		for (let smartyFunction of smartyFunctions)
		{
			completionSuggestions.push({
				label: smartyFunction,
				kind: CompletionItemKind.Method,
				data: dataIdx++
			});
		}
		// Custom functions
		for (let availablePlugin of availablePlugins)
		{
			if (
				availablePlugin.type === SmartyPluginType.function ||
				availablePlugin.type === SmartyPluginType.compiler ||
				availablePlugin.type === SmartyPluginType.block
			)
			{
				completionSuggestions.push({
					label: availablePlugin.pluginName,
					kind: CompletionItemKind.Method,
					data: dataIdx++
				});
			}
		}
	}
	// Closing blocks
	else if (lineText.substr(-2, 2) === '{/')
	{
		if (inSmartyLiteral)
		{
			completionSuggestions.push({
				label: "/literal}",
				kind: CompletionItemKind.Method,
				data: 0,
				textEdit: InsertReplaceEdit.create("/literal}", Range.create(doc.positionAt(doc.offsetAt(pos) - 1), pos), Range.create(doc.positionAt(doc.offsetAt(pos) - 1), pos))
			});
		}
		else
		{
			let dataIdx = 0;
			let sortedBlocks = getSmartyBlocksForPositionFromSmartyInfo(offset, smartyInfo, true).reverse();
			let seenBlockNames: any = {};
			for (let smartyBlock of sortedBlocks)
			{
				if (!(smartyBlock.blockName in seenBlockNames))
				{
					seenBlockNames[smartyBlock.blockName] = true;
					let startPos = doc.positionAt(doc.offsetAt(pos) - 1);
					completionSuggestions.push({
						label: "/" + smartyBlock.blockName,
						kind: CompletionItemKind.Method,
						data: dataIdx++,
						// TODO: I can't add } at the end because it won't unindent
						textEdit: InsertReplaceEdit.create("/" + smartyBlock.blockName, Range.create(startPos, pos), Range.create(startPos, pos))
					});
				}
			}
			// Preselect the first one
			if (completionSuggestions.length > 0)
				completionSuggestions[0].preselect = true; 
		}
	}
	// Variable with {$
	else if (!inSmartyLiteral && lineText.substr(-2, 2) === '{$')
	{
		let dataIdx = 0;
		let sortedVars = smartyInfo.variables.sort();
		for (let varName of sortedVars)
		{
			completionSuggestions.push({
				label: varName,
				kind: CompletionItemKind.Variable,
				data: dataIdx++,
				textEdit: InsertReplaceEdit.create(varName, Range.create(doc.positionAt(doc.offsetAt(pos) - 1), pos), Range.create(doc.positionAt(doc.offsetAt(pos) - 1), pos))
			});
		}
	}
	// Variable without {$, but still in a Smarty delimiters
	else if (!inSmartyLiteral && lineText.substr(-1, 1) === '$' && lastSmartyBlock !== null && isPositionInBlockDelimiter(doc, pos, lastSmartyBlock))
	{
		let dataIdx = 0;
		let sortedVars = smartyInfo.variables.sort();
		for (let varName of sortedVars)
		{
			completionSuggestions.push({
				label: varName,
				kind: CompletionItemKind.Variable,
				data: dataIdx++,
				textEdit: InsertReplaceEdit.create(varName, Range.create(doc.positionAt(doc.offsetAt(pos) - 1), pos), Range.create(doc.positionAt(doc.offsetAt(pos) - 1), pos))
			});
		}
	}
	// Attribute suggestions for specific blocks
	else if (!inSmartyLiteral && lastSmartyBlock !== null && lineText.substr(-1, 1) === ' ')
	{
		let possibleAttrs = smartyFunctionAttributes.get(lastSmartyBlock.blockName);
		if (possibleAttrs)
		{
			let dataIdx = 0;
			for (let attrName of possibleAttrs)
			{
				completionSuggestions.push({
					label: attrName,
					kind: CompletionItemKind.Property,
					data: dataIdx++
				});
			}
		}
		// Check for plugin attributes
		else
		{
			let plugin = getPlugin(lastSmartyBlock.blockName);
			if (plugin)
			{
				let dataIdx = 0;
				for (let attrName of plugin.possibleAttrs)
				{
					completionSuggestions.push({
						label: attrName,
						kind: CompletionItemKind.Property,
						data: dataIdx++
					});
				}
			}
		}
	}
	// Modifiers (must be in a Smarty delimiters)
	else if (
		!inSmartyLiteral && lineText.substr(-1, 1) === '|' && (
			/{\$[^{} ]+\|$/.test(lineText) ||
			(lastSmartyBlock !== null && isPositionInBlockDelimiter(doc, pos, lastSmartyBlock))
		)
	)
	{
		let dataIdx = 0;
		for (let smartyModifier of smartyModifiers)
		{
			completionSuggestions.push({
				label: smartyModifier,
				kind: CompletionItemKind.Method,
				data: dataIdx++
			});
		}
		// Custom modifiers
		for (let availablePlugin of availablePlugins)
		{
			if (availablePlugin.type === SmartyPluginType.modifier)
			{
				completionSuggestions.push({
					label: availablePlugin.pluginName,
					kind: CompletionItemKind.Method,
					data: dataIdx++
				});
			}
		}
	}

	return {
		isIncomplete: false,
		items: completionSuggestions
	};
}

/**
 * Get signature for plugin
 */
function getSignatureForPlugin(plugin: SmartyPlugin): SignatureHelp
{
	return {
		signatures: [
			{
				label: plugin.pluginName,
				documentation: plugin.comment || undefined,
				parameters: []
			}
		],
		activeSignature: 0,
		activeParameter: 0
	};
}

/**
 * Get signature
 */
async function getSignature(pos: Position, doc: TextDocument): Promise<SignatureHelp|null>
{
	let lineStartPos = Position.create(pos.line, 0);
	let range = Range.create(lineStartPos, pos);
	let offset = doc.offsetAt(pos);

	// Get Smarty blocks
	let smartyInfo = getCachedDocumentSmartyInfo(doc);
	// Check if we're in a literal
	let smartyCurrentBlocks = getSmartyBlocksForPositionFromSmartyInfo(offset, smartyInfo, true);
	if (smartyCurrentBlocks.length >  0)
	{
		let lastSmartyBlock = smartyCurrentBlocks[smartyCurrentBlocks.length - 1];
		// In literal
		if (lastSmartyBlock.blockName === "literal")
			return null;
		// Is it in the start tag (including end tag in case we're adding more to the end of tag)
		if (offset <= lastSmartyBlock.startTagEndOffset)
		{
			// Get plugin
			let plugin = getPlugin(lastSmartyBlock.blockName);
			if (plugin)
				return getSignatureForPlugin(plugin);
		}
	}

	// Handle modifiers
	let lineText = doc.getText(range);
	let lineOffset = pos.character;
	let possibleModifier = false;
	while (lineOffset > 0)
	{
		let c = lineText[lineOffset];
		if (c === "|")
		{
			possibleModifier = true;
			lineOffset++;
			break;
		}
		else if (c === "{" || c === "}")
			break;
		lineOffset--;
	}
	if (possibleModifier)
	{
		let pluginCursorInfo = getSmartyPluginInfoFromPos(lineText, lineOffset);
		if (pluginCursorInfo !== null)
		{
			let plugin = getPlugin(pluginCursorInfo.name);
			if (plugin)
				return getSignatureForPlugin(plugin);
		}
	}

	return null;
}
