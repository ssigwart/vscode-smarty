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
