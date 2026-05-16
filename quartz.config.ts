import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

/**
 * Quartz 4 Configuration
 *
 * See https://quartz.jzhao.xyz/configuration for more information.
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "블루의 블로그",
    pageTitleSuffix: "",
    enableSPA: true,
    enablePopovers: true,
    locale: "ko-KR",
    baseUrl: "bluebrosna.github.io",
    ignorePatterns: ["private", "templates", ".obsidian"],
    defaultDateType: "modified",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Noto Serif KR",
        body: "Noto Sans KR",
        code: "IBM Plex Mono",
      },
      colors: {
        lightMode: {
          light: "#1e3a5f",
          lightgray: "#2d4a6f",
          gray: "#8ba4c4",
          darkgray: "#e0e7ef",
          dark: "#ffffff",
          secondary: "#4a90d9",
          tertiary: "#6ba3d9",
          highlight: "rgba(74, 144, 217, 0.25)",
          textHighlight: "#ffd70088",
        },
        darkMode: {
          light: "#0d2137",
          lightgray: "#1a3a5c",
          gray: "#4a6f8a",
          darkgray: "#e0e7ef",
          dark: "#ffffff",
          secondary: "#4a90d9",
          tertiary: "#6ba3d9",
          highlight: "rgba(74, 144, 217, 0.25)",
          textHighlight: "#ffd70088",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "git", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
        keepBackground: false,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description(),
      Plugin.Latex({ renderEngine: "katex" }),
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.Favicon(),
      Plugin.NotFoundPage(),
      Plugin.CustomOgImages(),
    ],
  },
}

export default config
