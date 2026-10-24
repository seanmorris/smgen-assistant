// @ts-check

import jsdoc from "eslint-plugin-jsdoc";

const documentedFunctions = [
  "FunctionDeclaration",
  "MethodDefinition",
  "VariableDeclarator > ArrowFunctionExpression"
];

export default [
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  {
    files: ["src/**/*.mjs", "scripts/**/*.mjs"],
    plugins: { jsdoc },
    rules: {
      "jsdoc/check-tag-names": "error",
      "jsdoc/check-types": "error",
      "jsdoc/require-description": ["error", { contexts: documentedFunctions }],
      "jsdoc/require-jsdoc": ["error", {
        require: {
          ArrowFunctionExpression: false,
          FunctionDeclaration: true,
          FunctionExpression: false,
          MethodDefinition: true
        },
        contexts: ["VariableDeclarator > ArrowFunctionExpression"]
      }]
    }
  }
];
