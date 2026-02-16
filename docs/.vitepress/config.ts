import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Rulesync",
  description:
    "A Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files.",
  base: "/rulesync/",
  lastUpdated: true,

  head: [["link", { rel: "icon", href: "/rulesync/logo.jpg" }]],

  themeConfig: {
    logo: "/logo.jpg",

    nav: [
      { text: "Guide", link: "/getting-started/installation" },
      { text: "Reference", link: "/reference/supported-tools" },
      { text: "API", link: "/api/programmatic-api" },
      {
        text: "Links",
        items: [
          {
            text: "npm",
            link: "https://www.npmjs.com/package/rulesync",
          },
          {
            text: "Changelog",
            link: "https://github.com/dyoshikawa/rulesync/releases",
          },
        ],
      },
    ],

    sidebar: [
      {
        text: "Getting Started",
        items: [
          {
            text: "Installation",
            link: "/getting-started/installation",
          },
          { text: "Quick Start", link: "/getting-started/quick-start" },
        ],
      },
      {
        text: "Guide",
        items: [
          { text: "Why Rulesync?", link: "/guide/why-rulesync" },
          { text: "Configuration", link: "/guide/configuration" },
          { text: "Global Mode", link: "/guide/global-mode" },
          {
            text: "Simulated Features",
            link: "/guide/simulated-features",
          },
          {
            text: "Declarative Sources",
            link: "/guide/declarative-sources",
          },
          { text: "Official Skills", link: "/guide/official-skills" },
          { text: "Dry Run", link: "/guide/dry-run" },
          { text: "Case Studies", link: "/guide/case-studies" },
        ],
      },
      {
        text: "Reference",
        items: [
          {
            text: "Supported Tools",
            link: "/reference/supported-tools",
          },
          { text: "CLI Commands", link: "/reference/cli-commands" },
          { text: "File Formats", link: "/reference/file-formats" },
          { text: "MCP Server", link: "/reference/mcp-server" },
        ],
      },
      {
        text: "API",
        items: [
          {
            text: "Programmatic API",
            link: "/api/programmatic-api",
          },
        ],
      },
      { text: "FAQ", link: "/faq" },
    ],

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/dyoshikawa/rulesync",
      },
      { icon: "x", link: "https://x.com/dyoshikawa1993" },
    ],

    editLink: {
      pattern: "https://github.com/dyoshikawa/rulesync/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    search: {
      provider: "local",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright &copy; dyoshikawa",
    },
  },
});
