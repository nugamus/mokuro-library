import { defineConfig } from 'vitepress';

export default defineConfig({
  // CRITICAL: This MUST be set for GitHub Pages deployment
  base: '/mokuro-library/',

  title: 'Mokuro Library Guide',
  description: 'User guide for the Mokuro Library self-hosted manga server.',

  themeConfig: {
    // Navigation bar
    nav: [
      { text: 'Guide', link: '/managing-your-library' },
      { text: 'GitHub', link: 'https://github.com/nguyenston/mokuro-library' }
    ],

    // Sidebar for the user guide
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          // This links to your new index.md
          { text: 'Introduction', link: '/' },
        ]
      },
      {
        text: 'Using the Library',
        items: [
          { text: 'Managing Your Library', link: '/managing-your-library' },
          { text: 'Using the Reader', link: '/using-the-reader' },
          { text: 'Editing OCR Text', link: '/ocr-editing' },
        ]
      }
    ]
  }
});
