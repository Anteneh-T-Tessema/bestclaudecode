const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error("Usage: node ts_ast_parser.js <root_dir>");
  process.exit(1);
}

const _SKIP_DIR_NAMES = new Set(["__pycache__", ".venv", "venv", ".git", "node_modules", "dist", "build", ".next", "out"]);

function getFiles(dir) {
  let results = [];
  let list;
  try {
    list = fs.readdirSync(dir);
  } catch {
    return [];
  }
  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      return;
    }
    if (stat && stat.isDirectory()) {
      if (!_SKIP_DIR_NAMES.has(file) && !file.startsWith('.')) {
        results = results.concat(getFiles(fullPath));
      }
    } else {
      if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) {
        results.push(fullPath);
      }
    }
  });
  return results;
}

const files = getFiles(root);
const output = {};

files.forEach((file) => {
  try {
    const content = fs.readFileSync(file, 'utf-8');
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const symbols = [];

    function visit(node) {
      let kind = "";
      let name = "";
      let line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

      if (ts.isFunctionDeclaration(node) && node.name) {
        kind = "function";
        name = node.name.text;
      } else if (ts.isClassDeclaration(node) && node.name) {
        kind = "class";
        name = node.name.text;
      } else if (ts.isInterfaceDeclaration(node) && node.name) {
        kind = "interface";
        name = node.name.text;
      } else if (ts.isTypeAliasDeclaration(node) && node.name) {
        kind = "type";
        name = node.name.text;
      } else if (ts.isEnumDeclaration(node) && node.name) {
        kind = "enum";
        name = node.name.text;
      } else if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach((decl) => {
          if (decl.name && ts.isIdentifier(decl.name)) {
            const isFn = decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer));
            symbols.push(`  ${isFn ? 'function' : 'const'} ${decl.name.text}${isFn ? '()' : ''} -- line ${line}`);
          }
        });
        return;
      }

      if (kind && name) {
        symbols.push(`  ${kind} ${name}${kind === 'function' ? '()' : kind === 'class' ? ':' : ''} -- line ${line}`);
        
        if (ts.isClassDeclaration(node)) {
          node.members.forEach((member) => {
            if ((ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) && member.name && ts.isIdentifier(member.name)) {
              let mLine = sourceFile.getLineAndCharacterOfPosition(member.getStart()).line + 1;
              symbols.push(`    def ${member.name.text}() -- line ${mLine}`);
            }
          });
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    output[path.relative(root, file)] = symbols;
  } catch (e) {
    // skip failed files
  }
});

console.log(JSON.stringify(output));
