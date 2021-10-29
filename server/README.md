# About this Extension
- Most of the files in this `src/` and `libs/` are from https://github.com/microsoft/vscode/tree/main/extensions/html-language-features/server.
- It is under the MIT License.

# Updating this Folder
- In `htmlServer.ts`, `validateTextDocument` needs to be changed to allow `textDocument.languageId === 'smarty'`.
```bash
# Remove --dry-run when ready
export VSCODE_REPO_DIR="/path/to/vscode/"
rsync --dry-run -urltv --exclude smarty --exclude test --delete "${VSCODE_REPO_DIR}/extensions/html-language-features/server/src/" src/
rsync --dry-run -urltv --exclude smarty --delete "${VSCODE_REPO_DIR}/extensions/html-language-features/server/lib/" lib/
```
- Also update `package.json` and run `npm update`.
