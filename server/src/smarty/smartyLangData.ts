/** Smarty functions */
export const smartyFunctions: string[] = [
	"assign", 
	"capture",
	"counter",
	"foreach", "foreachelse",
	"if", "elseif", "else",
	"include", "include_php",
	"insert",
	"ldelim", "rdelim", 
	"literal",
	"php",
	"section", "sectionelse",
	"strip"
];

/** Common modifiers */
export const smartyModifiers: string[] = [
	"capitalize",
	"cat",
	"constant",
	"count_characters",
	"count_paragraphs",
	"count_sentences",
	"count_words",
	"date_format",
	"default",
	"escape",
	"htmlspecialchars",
	"indent",
	"json_decode",
	"json_encode",
	"lower",
	"nl2br",
	"number_format",
	"print_r",
	"regex_replace",
	"replace",
	"spacify",
	"string_format",
	"strip",
	"strip_tags",
	"truncate",
	"upper",
	"urldecode",
	"urlencode",
	"var_dump",
	"wordwrap"
];

/** Attributes for functions */
export const smartyFunctionAttributes: Map<string, string[]> = new Map([
	["assign", ["var", "value"]],
	["capture", ["name", "assign"]],
	["counter", ["name", "start", "skip", "direction", "print", "assign"]],
	["foreach", ["name", "from", "key", "item"]],
	["include", ["file", "assign"]],
	["section", ["name", "loop", "start", "step", "max", "show"]],
]);
