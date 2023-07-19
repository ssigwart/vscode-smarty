import * as fsAsync from 'fs/promises';
import { basename, sep as pathSep } from 'path';

import { hasWorkspaceFolderCapability, SmartyConfigSettings, getIndexStorage } from './smartyServer';
import { IndexStorageCacheNode } from "./indexStorage";

import { Connection } from 'vscode-languageserver/node';
import {
	WorkspaceFolder
} from 'vscode-languageserver-protocol';

import * as PHPParser from 'php-parser';

// Smarty plugins
export enum SmartyPluginType {
	function = 0,
	modifier = 1,
	compiler = 2,
	block = 3
};
export interface SmartyPlugin {
	path: string;
	pluginName: string;
	type: SmartyPluginType;
	definitionLine: number|null;
	comment: string|null;
	possibleAttrs: string[];
};
export let availablePlugins: SmartyPlugin[] = [];
let pluginsByName: Map<string, SmartyPlugin> = new Map();
let reloadAvailablePluginsPromise: Promise<void> = Promise.resolve();
let reloadAvailablePluginsTimeout: NodeJS.Timeout|null = null;
let debouncedReloadAvailablePlugins = function(pluginDirs: string[]): void
{
	if (reloadAvailablePluginsTimeout !== null)
		clearTimeout(reloadAvailablePluginsTimeout);
	reloadAvailablePluginsTimeout = setTimeout(() => {
		// Wait for last time to complete
		reloadAvailablePluginsPromise = reloadAvailablePluginsPromise.then(() => {
			availablePlugins = [];
			for (let pluginDir of pluginDirs)
			{
				let promises: Promise<void>[] = [];
				fsAsync.readdir(pluginDir).then(function(fileNames: string[]): Promise<void[]> {
					for (let fileName of fileNames)
					{
						let filePath = pluginDir + pathSep + fileName;
						promises.push(_reloadPluginFromFile(filePath));
					}
					return Promise.all(promises);
				}).catch(function(reason: any) {
					console.error("Failed to read plugin directory " + pluginDir + ".");
					console.error(reason);
				});
			}
		}).catch(function(reason: any) {
			console.error("Failed to read plugin directories.");
			console.error(reason);
		});
	}, 100);
}
export function reloadAvailablePlugins(pluginDirs: string[]): void
{
	debouncedReloadAvailablePlugins(pluginDirs);
}

// Set up PHP parser
let parser = new PHPParser.Engine({
	parser: {
		extractDoc: true,
		php7: true
	},
	ast: {
		withPositions: true
	}
});

/**
 * Is file in a plugin directory?
 * 
 * @param {string} filePath File path
 *
 * @return {boolean} True if in directory
 */
export function isFileInPluginDir(filePath: string): boolean
{
	for (let dir of pluginDirs)
	{
		if (filePath.startsWith(dir))
			return true;
	}
	return false;
}

/**
 * Check if a PHP node is a function
 */
 function isPhpFunction(node: PHPParser.Node): node is PHPParser.Function
 {
	 return node.kind === "function";
 }
 
/**
 * Check if a PHP node is an identifier
 */
 function isPhpIdentifier(node: PHPParser.Node): node is PHPParser.Identifier
 {
	 return node.kind === "identifier";
 }
 
	
/**
 * Reload a plugin from a file
 * 
 * @param {string} filePath File path
 */
async function _reloadPluginFromFile(filePath: string): Promise<void>
{
	// Add plugin
	let fileName = basename(filePath);
	let match = /^([^.]+)\.([^.]+)\.php$/.exec(fileName);
	if (match !== null)
	{
		let typeStr = match[1];
		let type: SmartyPluginType|null = null;
		if (typeStr === "function")
			type = SmartyPluginType.function;
		else if (typeStr === "modifier")
			type = SmartyPluginType.modifier;
		else if (typeStr === "compiler")
			type = SmartyPluginType.compiler;
		else if (typeStr === "block")
			type = SmartyPluginType.block;
		let name = match[2];
		if (type !== null)
		{
			// Get file info
			let indexStorage = getIndexStorage();
			let cacheNode: IndexStorageCacheNode<SmartyPlugin> | null = null;
			if (indexStorage !== null)
			{
				try {
					cacheNode = await indexStorage.getFileCacheNode(filePath);
				} catch (e) {
					console.error("Failed to get cache node for " + filePath + ".");
				}
			}

			// Check for cache hit
			let plugin: SmartyPlugin;
			if (cacheNode !== null && cacheNode.data !== null)
				plugin = cacheNode.data;
			// Read from file
			else
			{
				let contents = "" + (await fsAsync.readFile(filePath));
				let lines = contents.split(/\r?\n|\r/g);

				// Find function line and try to extract arguments
				let functionLine: number|null = null;
				let tokens = parser.tokenGetAll(contents);
				let lastFunctionLine = -1;
				let funcParamListStarted = false;
				let funcParamListEnded = false;
				let funcParams: string[] = [];
				let paramVar: string|null = null;
				let possibleAttrs: string[] = [];
				let expectingPossibleAttrBracket = false;
				let expectingPossibleAttr = false;
				let pluginComment: string|null = null
				let lastComment: string|null = null
				for (let token of tokens)
				{
					let newExpectingPossibleAttrBracket = false;
					let newExpectingPossibleAttr = false;
					if (Array.isArray(token))
					{
						let tokenType = token[0];

						// Start of function
						if (tokenType === "T_FUNCTION")
							lastFunctionLine = token[2];
						else if (tokenType !== "T_WHITESPACE")
						{
							// Possible function name
							if (tokenType === "T_STRING")
							{
								// If this the function?
								if (lastFunctionLine !== -1 && token[1] === "smarty_" + typeStr + "_" + name)
								{
									functionLine = lastFunctionLine - 1;
									pluginComment = lastComment;
								}
							}
							// Variable
							else if (tokenType === "T_VARIABLE")
							{
								if (funcParamListStarted && !funcParamListEnded)
									funcParams.push(token[1]);
								else if (token[1] === paramVar)
									newExpectingPossibleAttrBracket = true;
							}
							// Possible attribute
							else if (tokenType === "T_CONSTANT_ENCAPSED_STRING")
							{
								if (expectingPossibleAttr)
								{
									let attr = token[1].substring(1, token[1].length - 1);
									if (possibleAttrs.indexOf(attr) === -1)
										possibleAttrs.push(attr);
								}
							}
							// Comment
							else if (tokenType === "T_DOC_COMMENT" || tokenType === "T_COMMENT")
								lastComment = token[1];

							lastFunctionLine = -1;
						}
					}
					else if (typeof token === "string")
					{
						// Function info
						if (functionLine !== null)
						{
							// Function params start
							if (!funcParamListStarted && token === "(")
								funcParamListStarted = true;
							// Function params end
								else if (funcParamListStarted && !funcParamListEnded && token === ")")
							{
								funcParamListEnded = true;

								// Set $params variable
								if (funcParams.length > 0 && (type === SmartyPluginType.function || type === SmartyPluginType.block))
									paramVar = funcParams[0];
							}
							// Attribute
							else if (token === "[" && expectingPossibleAttrBracket)
								newExpectingPossibleAttr = true;
						}

						lastFunctionLine = -1;
					}
					expectingPossibleAttrBracket = newExpectingPossibleAttrBracket;
					expectingPossibleAttr = newExpectingPossibleAttr;
				}

				// Create plugin info
				plugin = {
					pluginName: name,
					type: type,
					path: filePath,
					definitionLine: functionLine,
					comment: pluginComment,
					possibleAttrs: possibleAttrs
				};

				// Save cache block
				if (indexStorage !== null && cacheNode !== null)
				{
					cacheNode.data = plugin;
					indexStorage.persistFileCacheNode(filePath, cacheNode);
				}
			}

			// Add plugin
			availablePlugins.push(plugin);
			pluginsByName.set(name, plugin);
		}
	}
}

/**
 * Reload a plugin from a file
 * 
 * @param {string} filePath File path
 */
export function reloadPluginFromFile(filePath: string): void
{
	// Check path
	if (!isFileInPluginDir(filePath))
		return;

	// Remove plugins already in this file
	_deletePluginFromFile(filePath);

	// Add file path
	_reloadPluginFromFile(filePath);
}

/**
 * Delete a plugin from a file
 * 
 * @param {string} filePath File path
 */
export function _deletePluginFromFile(filePath: string): void
{
	let newAvailablePlugins: SmartyPlugin[] = [];
	for (let plugin of availablePlugins)
	{
		if (plugin.path !== filePath)
			newAvailablePlugins.push(plugin);
		else
			pluginsByName.delete(plugin.pluginName);
	}
	availablePlugins = newAvailablePlugins;
}

/**
 * Reload a plugin from a file
 * 
 * @param {string} filePath File path
 */
export function deletePluginFromFile(filePath: string): void
{
	// Check path
	if (!isFileInPluginDir(filePath))
		return;

	_deletePluginFromFile(filePath);
}

let pluginDirs: string[] = [];

/**
 * Set up Smarty plugins from config
 *
 * @param {Connection} connection
 */
export function setUpSmartyPluginsFromConfig(connection: Connection): void
{
	let workspaceFoldersPromise: Promise<string[]> = Promise.resolve([]);
	if (hasWorkspaceFolderCapability)
	{
		workspaceFoldersPromise = connection.workspace.getWorkspaceFolders().then(function(folders: WorkspaceFolder[]|null): string[] {
			let rtn: string[] = [];
			if (folders !== null)
			{
				for (let folder of folders)
				{
					if (folder.uri.startsWith("file://"))
						rtn.push(folder.uri.substring(7));
				}
			}
			return rtn;
		});
	}

	// Load available plugins once we have workspace folders
	workspaceFoldersPromise.then(async function(folders: string[]) {
		pluginDirs = [];
		// By default, try to add "plugins" directory
		for (let folder of folders)
		{
			// Check for plugins folders
			let pluginsPath = folder + pathSep + "plugins";
			try
			{
				let dirStats = await fsAsync.stat(pluginsPath);
				if (dirStats.isDirectory())
				{
					console.log("Added " + pluginsPath + " to plugin paths.");
					pluginDirs.push(pluginsPath);
				}
			} catch (e) {
				console.log("Attempted to load plugins from " + pluginsPath + ", but failed. " + e);
			}
		}
		// Add from config
		return connection.workspace.getConfiguration({
			section: 'smarty'
		}).then(async function(smartySettings: SmartyConfigSettings) {
			for (let pluginDir of smartySettings.pluginDirs)
			{
				if (pluginDirs.indexOf(pluginDir) === -1)
				{
					try
					{
						let dirStats = await fsAsync.stat(pluginDir);
						if (dirStats.isDirectory())
						{
							console.log("Added " + pluginDir + " to plugin paths.");
							pluginDirs.push(pluginDir);
						}
					} catch (e) {
						console.log("Attempted to load plugins from " + pluginDir + ", but failed. " + e);
					}
				}
			}
			// Load plugins
			reloadAvailablePlugins(pluginDirs);
		});
	});
}

/**
 * Get plugin by name
 *
 * @param {string} name Plugin name
 */
export function getPlugin(name: string): SmartyPlugin|null
{
	return pluginsByName.get(name) || null;
}
