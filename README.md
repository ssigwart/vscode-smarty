# Smarty Language Server

This extension provides Smarty syntax highlighting and code intelligence.
For code intelligence, it uses the default HTML/CSS/JavaScript handling from VSCode and adds Smarty specific functionality.

## Features

The language server provides:

- Code completion for standard Smarty 2 blocks and common modifiers.
- Smarty plugin directory support with signatures.
	- The code automatically searches for `plugins` directories and can be configured to point to additional directories.
	- Custom block and compiler functions will be suggested if found in the plugin directory. In addition, attributes for custom functions will be suggested.
	- Custom modifiers will be suggested in found in the plugin directory.
- Variable completion will suggest variables seen elsewhere in the same file.
- The `file` attribute of `{include}` is a link to the included template.
- XSS vulnerability warnings.

## Extension Settings

This extension allows the following settings:

- `smarty.maxNumberOfDiagnosticMsgs`: Maximum number of warnings or errors to show (e.g. XSS warnings).
- `smarty.pluginDirs`: List of directories to search fro Smarty plugins in.
- `smarty.xssExemptRegularExpressions`: List of regular expressions to disable XSS warnings on. For example, `"_ts$"` will skip warnings on variables ending in `_ts` and `"^\\$myVar$"` will skip warnings on the `$myVar` variable.
- `smarty.xssExemptModifiers`: List of Smarty modifiers that will suppress XSS warning. For example, `"custom_xss_cleaner"` would remove warnings on `{$myVar|custom_xss_cleaner}`.

## Release Notes

### 1.0.0

Initial release of Smarty language server.
