import { defineConfig } from "vitepress";

const siteUrl = "https://rulesync.dyoshikawa.com";

export default defineConfig({
  title: "Rulesync",
  description:
    "A Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files.",
  base: "/",
  lastUpdated: true,

  // Advertise every page under a single extensionless URL. GitHub Pages keeps
  // serving both `/page` and `/page.html`; this only controls the form used by
  // internal links and the sitemap, and the canonical link below is what tells
  // search engines which of the two is authoritative.
  cleanUrls: true,

  sitemap: {
    hostname: `${siteUrl}/`,
  },

  // VitePress has no built-in canonical link, so emit one per page. The URL is
  // derived from the source path, which holds as long as `rewrites` is unused.
  transformHead: ({ pageData }) => {
    // 404 is not a real URL, so it must not declare itself canonical.
    if (pageData.relativePath === "404.md") {
      return [];
    }

    const pagePath = pageData.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "");
    // Encode per segment: `encodeURI` would leave `#` and `?` intact, turning
    // part of a filename into a fragment or a query string.
    const pageUrl = `${siteUrl}/${pagePath.split("/").map(encodeURIComponent).join("/")}`;

    return [
      ["link", { rel: "canonical", href: pageUrl }],
      // Social crawlers canonicalize on og:url rather than on rel=canonical.
      ["meta", { property: "og:url", content: pageUrl }],
    ];
  },

  head: [
    ["link", { rel: "icon", href: "/logo.jpg" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "Rulesync" }],
    [
      "meta",
      {
        property: "og:description",
        content:
          "A Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files.",
      },
    ],
    [
      "meta",
      {
        property: "og:image",
        content: `${siteUrl}/logo.jpg`,
      },
    ],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:title", content: "Rulesync" }],
    [
      "meta",
      {
        name: "twitter:description",
        content:
          "A Node.js CLI tool that automatically generates configuration files for various AI development tools from unified AI rule files.",
      },
    ],
    [
      "meta",
      {
        name: "twitter:image",
        content: `${siteUrl}/logo.jpg`,
      },
    ],
  ],

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
          { text: "Plugin Packaging", link: "/guide/plugin-packaging" },
          { text: "Global Mode", link: "/guide/global-mode" },
          { text: "Separate Input Root", link: "/guide/separate-input-root" },
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
          { text: "Command Syntax", link: "/reference/command-syntax" },
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
