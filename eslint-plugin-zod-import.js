/**
 * ESLint plugin to enforce zod/v4-mini imports
 */

const zodMiniRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce using zod/v4-mini instead of zod or zod/v4",
      category: "Best Practices",
      recommended: true,
    },
    fixable: "code",
    schema: [],
    messages: {
      useZodMini: 'Use "zod/v4-mini" instead of "{{actual}}" for reduced bundle size',
    },
  },

  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;

        // Check if importing from 'zod' or 'zod/v4'
        if (source === "zod" || source === "zod/v4") {
          context.report({
            node: node.source,
            messageId: "useZodMini",
            data: {
              actual: source,
            },
            fix(fixer) {
              // Replace with zod/v4-mini
              return fixer.replaceText(node.source, '"zod/v4-mini"');
            },
          });
        }
      },
    };
  },
};

const plugin = {
  rules: {
    "use-zod-mini": zodMiniRule,
  },
  configs: {
    recommended: {
      rules: {
        "zod-mini/use-zod-mini": "error",
      },
    },
  },
};

export default plugin;
