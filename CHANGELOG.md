# Change Log

## 1.0.0
- Initial release

## 1.0.1
- Removed debug startup message

## 1.0.2
- Fix XSS exempt plugin config variable

## 1.0.3
- Update indentation rules for HTML.
- The `file` attribute of `{include}` will autocomplete if the current file includes `/templates/` in it’s page.
- Add `{literal}` tag autocompletion.

## 1.0.4
- Only decrease indent if closing tag is on it's own line. This prevents `{/if}` from decreasing the indent in this code:
```smarty
<div>
	<div {if $a}class="a"{/if}>
	</div>
</div>
```

## 1.0.5
- Allow modifier completions with @ and string literals.
- Added setting for custom modifiers. Using `smarty.customModifiers`, you can add custom modifier suggestions for those that don't exist in the normal plugins directory.

## 1.0.6
- Decrease indent after `foreachelse`.
- Don't indent after open/close on the same line.
	- E.g. `<th></th>` will no longer indent after it.

## 1.0.7
- Added `smarty.disableHtmlAttributeCompletionQuotes` setting to determine if HTML attribute such as `class=\"...\"` should include quotes in the completion. *If you like this option, please add a +1 react and comment on https://github.com/microsoft/vscode/issues/131144 to request that it be added to the standard HTML language in VS Code.*
- HTML autocompletion for long form boolean attributes such as `required="required"`.
- Decrease indent after `else` and `elseif`.

## 1.0.8
- Updated underlying VS Code HTML language server.

## 1.0.9
- Added document links for `*.tpl` files in PHP files.

## 1.0.10
- Added `smarty.copyTplPath` command to copy the template path.

## 1.0.11
- Capitalized "Smarty" in command.
- Fix improper indentation after single line `{if}`.

## 1.0.12
- Fixed improper indentation after `<input value="{$a->a|htmlspecialchars}" />` caused by `->`.

## 1.0.13
- Fixed indentation after `<div class="margin-0">` (caused by 1.0.12).

## 1.0.14
- Fix number constant detection.

## 1.0.15
- Fix `{assign}` variable name parsing.
- Fix duplicate completions.
- Skip XSS warning on `$id` and `$html`.

## 1.0.16
- Fix duplicate completions due to concurrent file system requests and custom overrides of Smarty plugins

## 1.0.17
- Support single quotes for `{include file=...}`.
