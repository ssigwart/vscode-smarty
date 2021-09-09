# Smarty Language Server

This extension provides Smarty syntax highlighting and code intelligence.
For code intelligence, it uses the default HTML/CSS/JavaScript handling from VSCode and adds Smarty specific functionality.

## What’s New?
- Check out [the changelog](./CHANGELOG) to see what’s new.

## Features

The language server provides:

- Code completion for standard Smarty 2 blocks and common modifiers.
- Smarty plugin directory support with signatures.
	- The code automatically searches for `plugins` directories and can be configured to point to additional directories.
	- Custom block and compiler functions will be suggested if found in the plugin directory. In addition, attributes for custom functions will be suggested.
	- Custom modifiers will be suggested in found in the plugin directory.
- Variable completion will suggest variables seen elsewhere in the same file.
- The `file` attribute of `{include}` is a link to the included template.
- The `file` attribute of `{include}` will autocomplete if the current file includes `/templates/` in it’s page.
- XSS vulnerability warnings.

## Extension Settings

This extension allows the following settings:

- `smarty.maxNumberOfDiagnosticMsgs`: Maximum number of warnings or errors to show (e.g. XSS warnings).
- `smarty.disableHtmlAttributeCompletionQuotes`: When completing an HTML attribute such as `class=\"...\"`, should quotes be stripped? If you like this option, please add a +1 react and comment on https://github.com/microsoft/vscode/issues/131144 to request that it be added to the standard HTML language in VS Code.
- `smarty.pluginDirs`: List of directories to search fro Smarty plugins in.
- `smarty.xssExemptRegularExpressions`: List of regular expressions to disable XSS warnings on. For example, `"_ts$"` will skip warnings on variables ending in `_ts` and `"^\\$myVar$"` will skip warnings on the `$myVar` variable.
- `smarty.xssExemptModifiers`: List of Smarty modifiers that will suppress XSS warning. For example, `"custom_xss_cleaner"` would remove warnings on `{$myVar|custom_xss_cleaner}`.
- `smarty.customModifiers`: List of custom Smarty modifiers to show in completions. This is useful for plugins not defined in the plugins directory.
