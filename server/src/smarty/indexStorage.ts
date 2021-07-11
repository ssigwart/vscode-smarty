import * as fsAsync from "fs/promises";
import { basename, sep as pathSep } from "path";
import { createHash } from "crypto";

/** Index cache node */
export interface IndexStorageCacheNode<T>
{
	/** File modified time in ms */
	fileModifiedTimeMs: number;

	/** Cache block */
	cacheBlockName: string;

	/** Cached data */
	data: T|null;
}

/** Index cache block */
export interface IndexStorageCacheBlock<T>
{
	purgeTimeout?: NodeJS.Timeout;
	/** Map of file path to node */
	fileNodes: Map<string, IndexStorageCacheNode<T>>;
}

/** Pending cache block write */
interface PendingIndexStorageCacheBlockWrite<T>
{
	cacheBlock: IndexStorageCacheBlock<T>;
	result: Promise<boolean>;
	promiseResolve: (rtn: boolean) => void;
	promiseReject: (e: any) => void,
	timeoutId: NodeJS.Timeout;
}

/** Index storage */
export class IndexStorage<T>
{
	/** Extension storage directory */
	protected storageDir: string;

	/** Index directory */
	protected indexDir: string;

	/** Index version */
	protected version: number;

	/** Cache blocks being loaded */
	loadingCacheBlocks: Map<string, Promise<IndexStorageCacheBlock<T>>> = new Map();

	/** Loaded cache blocks */
	loadedCacheBlocks: Map<string, IndexStorageCacheBlock<T>> = new Map();

	/**
	 * Constructor
	 */
	constructor(storageDir: string, version: number)
	{
		this.storageDir = storageDir;
		this.indexDir = this.storageDir + pathSep + "index";
		this.version = version;
		this.initStorage().then(() => {
			console.log("Set up index at " + this.storageDir + ".");
		}).catch((e) => {
			console.error("Failed to set up at " + this.storageDir + ".");
			console.error(e);
		});
	}

	/**
	 * Get index version
	 */
	public getVersion(): number
	{
		return this.version;
	}

	/**
	 * Get metadata file path
	 */
	 protected getMetaFilePath(): string
	 {
		 return this.storageDir + pathSep + "meta.json";
	 }

	/**
	 * Write metadata file
	 */
	protected async writeMetaFile(): Promise<void>
	{
		let json = JSON.stringify({
			version: this.version
		});
		await fsAsync.writeFile(this.getMetaFilePath(), json);
	}

	/**
	 * Check if file or directory exists
	 */
	protected async fileOrDirExists(path: string): Promise<boolean>
	{
		let exists = false;
		await fsAsync.access(this.storageDir).then(() => {exists = true; }).catch(() => {exists = false; });
		return exists;
	}

	/**
	 * Initialize storage
	 */
	protected async initStorage(): Promise<void>
	{
		const that = this;

		// Make sure the main directory exists
		if (!await this.fileOrDirExists(this.storageDir))
			await fsAsync.mkdir(this.storageDir);

		// Set up index directory
		if (!await this.fileOrDirExists(this.indexDir))
			await fsAsync.mkdir(this.indexDir);

		// Set up metadata file
		await fsAsync.readFile(that.getMetaFilePath()).then(async function(contents: Buffer) {
			let json = JSON.parse(contents.toString());

			// Check if this is the right version
			if (json.version === undefined || json.version !== that.version)
			{
				console.log("Old version. Recreating metadata.");
				// Rebuild index
				await fsAsync.rm(that.indexDir, {
					force: true,
					recursive: true
				});
				await fsAsync.mkdir(that.indexDir);
				return that.writeMetaFile();
			}
		}).catch(function() {
			console.log("Need to create metadata.");
			return that.writeMetaFile();
		});
	}

	/**
	 * Get cache block filename
	 *
	 * @param {string} cacheBlockName Cache block name
	 *
	 * @return {string} File path
	 */
	protected getCacheBlockPath(cacheBlockName: string): string
	{
		return this.indexDir + pathSep + cacheBlockName + ".json";
	}

	/** Time before purging a cache block */
	protected cacheBlockPurgeTimeoutMs = 300000; // 5 minutes

	/**
	 * Get cache block
	 *
	 * @param {string} cacheBlockName Cache block name
	 */
	protected async getCacheBlock(cacheBlockName: string): Promise<IndexStorageCacheBlock<T>>
	{
		const that = this;

		// Check if we have the cache block locally
		let cacheBlock = this.loadedCacheBlocks.get(cacheBlockName);
		if (cacheBlock !== undefined)
		{
			// Reset purge timeout
			if (cacheBlock.purgeTimeout !== undefined)
				clearTimeout(cacheBlock.purgeTimeout);
			cacheBlock.purgeTimeout = setTimeout(() => {
				if (cacheBlock)
					delete(cacheBlock.purgeTimeout);
				that.loadedCacheBlocks.delete(cacheBlockName);
			}, that.cacheBlockPurgeTimeoutMs);

			return cacheBlock;
		}

		// Check if we are loading it
		let loadingPromise = that.loadingCacheBlocks.get(cacheBlockName);
		if (loadingPromise)
			return await loadingPromise;

		// Get cache block from file
		let cacheBlockPath: string = this.getCacheBlockPath(cacheBlockName);
		try
		{
			let promise = fsAsync.readFile(cacheBlockPath).then((cacheBlockContents): IndexStorageCacheBlock<T> => {
				let cacheBlockJson = JSON.parse("" + cacheBlockContents);
				return {
					fileNodes: new Map(cacheBlockJson.fileNodes || {}),
					purgeTimeout: setTimeout(() => {
						that.loadedCacheBlocks.delete(cacheBlockName);
					}, that.cacheBlockPurgeTimeoutMs)
				};
			});
			that.loadingCacheBlocks.set(cacheBlockName, promise);
			cacheBlock = await promise;
		} catch (e) {
			// File may not exist
		}
		// Create cache block if not set
		if (cacheBlock === undefined)
		{
			cacheBlock = {
				fileNodes: new Map(),
				purgeTimeout: setTimeout(() => {
					that.loadedCacheBlocks.delete(cacheBlockName);
				}, that.cacheBlockPurgeTimeoutMs)
			};
		}
		return cacheBlock;
	}

	/**
	 * Check for file in cache
	 *
	 * @param {string} filePath Full file path
	 *
	 * @return {IndexStorageCacheNode<T>} Cache node. It may not have data
	 */
	public async getFileCacheNode(filePath: string): Promise<IndexStorageCacheNode<T>>
	{
		// Get file modified time
		let mtimeMs: number|null = null;
		try 
		{
			let fileStats = await fsAsync.stat(filePath);
			mtimeMs = fileStats.mtimeMs;
		} catch (e) {
			console.error("Failed to get file stats for " + filePath + ".");
			mtimeMs = (new Date()).getTime();
		};

		// Check if we have a cache block
		// Cache block is based on first 3 characters of filename
		let fileName = basename(filePath);
		let md5 = createHash("md5").update(fileName).digest("hex");
		let cacheBlockName = md5.substring(0, 3);
		let cacheBlock = await this.getCacheBlock(cacheBlockName);

		// Check if there's a valid cache node
		let cacheNode = cacheBlock.fileNodes.get(filePath);
		if (cacheNode !== undefined && cacheNode.fileModifiedTimeMs === mtimeMs)
			return cacheNode;

		// Not found
		return {
			fileModifiedTimeMs: mtimeMs,
			cacheBlockName: cacheBlockName,
			data: null
		};
	}

	/** Pending cache block writes */
	protected pendingCacheBlockWrites: Map<string, PendingIndexStorageCacheBlockWrite<T>> = new Map();

	/**
	 * Queue cache block write
	 *
	 * @param {string} cacheBlockName Cache block name
	 * @param {IndexStorageCacheBlock<T>} cacheBlock Cache block
	 *
	 * @return {Promise<boolean>} True if persisted
	 */
	protected async queueCacheBlockWrite(cacheBlockName: string, cacheBlock: IndexStorageCacheBlock<T>): Promise<boolean>
	{
		const that = this;
		const timeoutMs = 1000;
		let promise: Promise<boolean>;

		// Set up timeout function
		let timeoutFunc = () => {
			let pendingCacheBlockWrite = that.pendingCacheBlockWrites.get(cacheBlockName);
			if (pendingCacheBlockWrite !== undefined)
			{
				// Delete pending write
				that.pendingCacheBlockWrites.delete(cacheBlockName);

				// Build JSON
				let json: string = JSON.stringify({
					fileNodes: Array.from(cacheBlock.fileNodes.entries())
				});

				// Save file
				let cacheBlockPath: string = this.getCacheBlockPath(cacheBlockName);
				return fsAsync.writeFile(cacheBlockPath, json).then(() => {
					if (pendingCacheBlockWrite !== undefined)
						pendingCacheBlockWrite.promiseResolve(true);
				}).catch(() => {
					if (pendingCacheBlockWrite !== undefined)
						pendingCacheBlockWrite.promiseResolve(false);
				});
			}
		};
		// Check if there's already a pending write
		let pendingCacheBlockWrite = that.pendingCacheBlockWrites.get(cacheBlockName);
		if (pendingCacheBlockWrite)
		{
			// Start a new timeout with the new cache block
			clearTimeout(pendingCacheBlockWrite.timeoutId);
			pendingCacheBlockWrite.cacheBlock = cacheBlock;
			pendingCacheBlockWrite.timeoutId = setTimeout(timeoutFunc, timeoutMs);
			promise = pendingCacheBlockWrite.result;
		}
		else
		{
			promise = new Promise<boolean>((promiseResolve, promiseReject) => {
				let timeoutId = setTimeout(timeoutFunc, timeoutMs);
				pendingCacheBlockWrite = {
					cacheBlock: cacheBlock,
					timeoutId: timeoutId,
					result: promise,
					promiseResolve: promiseResolve,
					promiseReject: promiseReject
				};
				that.pendingCacheBlockWrites.set(cacheBlockName, pendingCacheBlockWrite);
			});
		}

		return promise;
	}

	/**
	 * Persist file in cache
	 *
	 * @param {string} filePath Full file path
	 * @param {IndexStorageCacheNode<T>} cacheNode Cache node
	 *
	 * @return {Promise<boolean>} True if persisted
	 */
	public async persistFileCacheNode(filePath: string, cacheNode: IndexStorageCacheNode<T>): Promise<boolean>
	{
		// Get cache block
		let cacheBlock = await this.getCacheBlock(cacheNode.cacheBlockName);

		// Update cache block
		cacheBlock.fileNodes.set(filePath, cacheNode);

		// Save locally
		this.loadedCacheBlocks.set(cacheNode.cacheBlockName, cacheBlock);

		// Queue updates
		return this.queueCacheBlockWrite(cacheNode.cacheBlockName, cacheBlock);
	}
}
