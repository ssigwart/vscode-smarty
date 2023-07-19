import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import {
	LanguageService as HTMLLanguageService,
	TokenType,
	Scanner,
} from 'vscode-html-languageservice';

export enum DocumentLanguageType {
	HTML = 0,
	JavaScript = 1,
	CSS = 2
};

export interface DocumentSmartyBlock {
	startOffset: number;
	startTagEndOffset: number;
	endOffset: number|null;
	blockName: string;
};

export interface DocumentSmartyIncludeFile {
	startOffset: number;
	endOffset: number;
	filename: string;
};

export interface DocumentSmartyInfo {
	blocks: DocumentSmartyBlock[];
	variables: string[];
	includeFiles: DocumentSmartyIncludeFile[];
	commentOffsets: [number,number][];
};

/**
 * Get document Smarty info
 * 
 * @param {TextDocument} doc Document
 * 
 * @return {DocumentSmartyInfo
 */
export function getDocumentSmartyInfo(doc: TextDocument): DocumentSmartyInfo
{
	let vars: Record<string, string>  = {};
	let blocks: DocumentSmartyBlock[] = [];
	let includeFiles: DocumentSmartyIncludeFile[] = [];
	let text = doc.getText();
	let blockStacks: Record<string, DocumentSmartyBlock[]>  = {};
	let commentOffsets: [number,number][] = [];
	let len = text.length;
	let inLiteral = false;
	for (let i = 0; i < len;)
	{
		let c = text[i];
		// Block
		if (c === "{")
		{
			let bracePos = i;
			i++;
			let c2 = text[i];

			// Variable
			if (!inLiteral && c2 === "$")
			{
				let varName = "$";
				for (i++; i < len; i++)
				{
					let c2 = text[i];
					if (/[0-9A-Za-z_]/.test(c2))
						varName += c2;
					else
						break;
				}
				if (varName !== "$")
					vars[varName] = varName;
			}
			// Comment
			else if (!inLiteral && c2 === "*")
			{
				let hasStar = false;
				for (i++; i < len; i++)
				{
					c2 = text[i];
					if (c2 === "*")
						hasStar = true;
					else if (hasStar)
					{
						if (c2 === "}")
							break;
						hasStar = false;
					}
				}
				commentOffsets.push([bracePos, i]);
			}
			// Block function
			else
			{
				let blockName = "";
				let isClose = false;
				if (c2 === "/")
				{
					isClose = true;
					i++;
				}
				for (; i < len; i++)
				{
					c2 = text[i];
					if (/[0-9A-Za-z_]/.test(c2))
						blockName += c2;
					else
						break;
				}
				if (blockName !== "")
				{
					let isLiteral = blockName === "literal";
					if (!inLiteral || (isLiteral && isClose))
					{
						if (isLiteral)
							inLiteral = !inLiteral;
						let stack: DocumentSmartyBlock[] = [];
						if (blockName in blockStacks)
							stack = blockStacks[blockName];
						else
						blockStacks[blockName] = stack;
						// Closing
						if (isClose)
						{
							if (stack.length > 0)
							{
								let block = stack.pop();
								block!.endOffset = i;
							}
						}
						// Opening
						else
						{
							// Get close of start tag
							let openTagRemainder = "";
							let openTagRemainderStartIdx = i;
							let startTagEndPos: number = len - 1;
							for (; i < len; i++)
							{
								c2 = text[i];
								// Find close
								if (c2 === "}")
								{
									startTagEndPos = i;
									break;
								}
								// Improper tag
								if (c2 === "{")
								{
									i--;
									startTagEndPos = i;
									break;
								}
								openTagRemainder += c2;
							}

							// Set end on things like {assign} {counter}, etc
							let endOffset: number|null = null;
							if (/^assign|counter|foreachelse|elseif|else|include|include_php|insert|ldelim|rdelim|sectionelse$/.test(blockName))
								endOffset = i;

							let block = {
								startOffset: bracePos,
								startTagEndOffset: startTagEndPos,
								endOffset: endOffset,
								blockName: blockName
							};
							blocks.push(block);
							stack.push(block);

							// Find variables
							let regex: RegExp|null = new RegExp("\\$[0-9A-Za-z_]+", "g");
							let match;
							while ((match = regex.exec(openTagRemainder)) !== null)
							{
								let varName = match[0];
								vars[varName] = varName;
							}

							// Assign var, loop key and item
							regex = null;
							if (blockName === "assign")
								regex = new RegExp("var=[\"']([0-9A-Za-z_]+)[\"']", "g");
							else if (blockName === "foreach")
								regex = new RegExp("(?:key|item)=[\"']([0-9A-Za-z_]+)[\"']", "g");
							if (regex !== null)
							{
								while ((match = regex.exec(openTagRemainder)) !== null)
								{
									let varName = "$" + match[1];
									vars[varName] = varName;
								}
							}

							// Find assign="..." attribute
							match = /assign="([0-9A-Za-z_]+)"/.exec(openTagRemainder);
							if (match !== null)
							{
								let varName = "$" + match[1];
								vars[varName] = varName;
							}
							else
							{
								match = /assign='([0-9A-Za-z_]+)'/.exec(openTagRemainder);
								if (match !== null)
								{
									let varName = "$" + match[1];
									vars[varName] = varName;
								}
							}

							// Find include files
							if (blockName === "include")
							{
								match = /(\s+file=")([^"]+)"/.exec(openTagRemainder);
								if (match !== null)
								{
									let offset = openTagRemainderStartIdx + match.index + match[1].length;
									let filename = match[2];
									includeFiles.push({
										filename: filename,
										startOffset: offset,
										endOffset: offset + filename.length
									});
								}
							}
						}
					}
				}
			}
		}
		// Ignore anything else in a literal
		else if (inLiteral)
			i++;
		// vars
		else
			i++;
	}

	return {
		blocks: blocks,
		variables: Object.values(vars),
		includeFiles: includeFiles,
		commentOffsets: commentOffsets
	};
}

export function getSmartyBlocksForPositionFromSmartyInfo(offset: number, smartyInfo: DocumentSmartyInfo, includeUnclosed: boolean): DocumentSmartyBlock[]
{
	let rtn: DocumentSmartyBlock[] = [];
	for (let block of smartyInfo.blocks)
	{
		if (block.startOffset <= offset)
		{
			if (block.endOffset === null)
			{
				if (includeUnclosed)
					rtn.push(block);
			}
			else if (block.endOffset >= offset)
				rtn.push(block);
		}
		else
			break;
	}
	return rtn;
}

export interface DocumentLanguageRange {
	startOffset: number,
	endOffset: number,
	lang: DocumentLanguageType,
	inAttr: boolean
};

/**
 * Get attribute value without quotes
 */
function getScannerAttrVal(scanner: Scanner): string
{
	let text = scanner.getTokenText();
	return text.substring(1, text.length - 1); // Remove quotes
}

export function getDocumentLanguageRanges(doc: TextDocument, htmlLangService: HTMLLanguageService): DocumentLanguageRange[]
{
	let rtn: DocumentLanguageRange[] = [];

	// Parse the file
	let scanner = htmlLangService.createScanner(doc.getText());
	let inScript = false;
	let lastAttrName: string|null = null;
	let scriptType: string|null = null;
	let token = scanner.scan();
	while (token !== TokenType.EOS)
	{
		// Script tag contents
		if (token === TokenType.Script)
		{
			// Check type
			if (scriptType === null || scriptType === "text/javascript")
			{
				rtn.push({
					startOffset: scanner.getTokenOffset(),
					endOffset: scanner.getTokenEnd(),
					lang: DocumentLanguageType.JavaScript,
					inAttr: false
				});
				console.log(scanner.getTokenText());
			}
		}
		// CSS tag contents
		else if (token === TokenType.Styles)
		{
			rtn.push({
				startOffset: scanner.getTokenOffset(),
				endOffset: scanner.getTokenEnd(),
				lang: DocumentLanguageType.CSS,
				inAttr: false
			});
			console.log(scanner.getTokenText());
		}
		// Start of a tag
		else if (token === TokenType.StartTag)
		{
			// If starting a new script tag, reset type. We'll check attributes next
			if (/^script$/i.test(scanner.getTokenText()))
			{
				inScript = true;
				scriptType = null;
			}
		}
		// Close of start tag
		else if (token === TokenType.StartTagClose)
			inScript = false;
		// Attribute name
		else if (token === TokenType.AttributeName)
			lastAttrName = scanner.getTokenText();
		// Attribute value
		else if (token === TokenType.AttributeValue)
		{
			// In a script
			if (inScript)
			{
				if (lastAttrName === "type")
					scriptType = getScannerAttrVal(scanner);
			}
			// Style attribute
			else if (lastAttrName === "style")
			{
				// Remove quotes
				rtn.push({
					startOffset: scanner.getTokenOffset() + 1,
					endOffset: scanner.getTokenEnd() - 1,
					lang: DocumentLanguageType.CSS,
					inAttr: true
				});
			}
		}

		// Get next token
		token = scanner.scan();
	}

	return rtn;
}
