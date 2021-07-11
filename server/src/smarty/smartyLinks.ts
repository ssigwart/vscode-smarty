import * as fs from 'fs';
import { sep as pathSep } from 'path';

import {
	TextDocument
} from '../modes/languageModes';

import {
	Connection,
	Range,
	Position
} from 'vscode-languageserver/node';

import {
	DocumentLinkParams, DocumentLink,
} from 'vscode-languageserver-protocol';

import {
	getCachedDocumentSmartyInfo
} from './smartyServer';

import {
	CancellationToken,
	ServerRequestHandler,
	ResponseError,
	WorkDoneProgressReporter,
	ResultProgressReporter 
} from 'vscode-languageserver';
import { getDocument } from './smartyServer';
import { runSafe } from '../utils/runner';

/**
 * Handle document link request
 */
export async function getDocumentLinks(params: DocumentLinkParams, doc: TextDocument): Promise<DocumentLink[]|null>
{
	let rtn: DocumentLink[] = [];
	// Get the line text
	let currentUri = params.textDocument.uri;
	if (currentUri.startsWith("file://"))
	{
		let currentFilename = currentUri.substring(7);
		let smartyInfo = getCachedDocumentSmartyInfo(doc);
		for (let includeFile of smartyInfo.includeFiles)
		{
			// Try to find file
			let path: string|null = null;
			let dirs = currentFilename.split(pathSep);
			dirs.pop(); // Remove filename
			let defaultPath: string|null = null;
			while (dirs.length > 0)
			{
				path = dirs.join(pathSep) + pathSep + includeFile.filename;
				if (fs.existsSync(path))
					break;
				if (defaultPath === null)
					defaultPath = path;
				path = null;
				dirs.pop();
			}
			// Guess at path
			if (path === null)
			{
				let match = /^(.*\/templates\/)/.exec(currentFilename);
				if (match !== null)
					path = match[1].replace("/", pathSep) + pathSep + includeFile.filename;
				else
					path = defaultPath;
			}
			if (path !== null)
			{
				let uri = "file://" + path;
				let firstPos = Position.create(0, 0);
				rtn.push(DocumentLink.create(
					Range.create(doc.positionAt(includeFile.startOffset), doc.positionAt(includeFile.endOffset)),
					uri
				));
			}
		}
	}

	return rtn;
}

/**
 * Check if an onDocumentLinks handle result is DocumentLink[]
 */
function isDocumentLinksResultADocumentLinkList(list: any): list is DocumentLink[]
{
	return Array.isArray(list);
}

export function extendConnectionDocumentLinks(connection: Connection): void
{
	let stdOnDocumentLinks = connection.onDocumentLinks;
	connection.onDocumentLinks = function(handler: ServerRequestHandler<DocumentLinkParams, DocumentLink[] | undefined | null, DocumentLink[], void>): void
	{
		let modifiedHandler = async function(documentLinkParam: DocumentLinkParams, token: CancellationToken, workDoneProgress: WorkDoneProgressReporter, resultProgress?: ResultProgressReporter<DocumentLink[]>): Promise<DocumentLink[]|null|ResponseError<void>>
		{
			return runSafe(async () => {
				let htmlLinks = await handler(documentLinkParam, token, workDoneProgress, resultProgress);
				if (htmlLinks === null)
					return null;
				let links: DocumentLink[] = [];
				if (isDocumentLinksResultADocumentLinkList(htmlLinks))
					links = htmlLinks;

				// Get document
				const document = getDocument(documentLinkParam.textDocument.uri);
				if (document)
				{
					// Add Smarty links
					let smartyLinks = await getDocumentLinks(documentLinkParam, document);
					if (smartyLinks !== null)
					{
						for (let link of smartyLinks)
							links.push(link);
					}
				}

				return links;
			}, null, `Error while computing completions for ${documentLinkParam.textDocument.uri}`, token);
		};
		stdOnDocumentLinks(modifiedHandler);
	}
}
