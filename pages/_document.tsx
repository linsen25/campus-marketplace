import type { DocumentContext } from 'next/document'
import Document, { Html, Head, Main, NextScript } from 'next/document'

export default class MyDocument extends Document {
  static async getInitialProps(ctx: DocumentContext) {
    const initialProps = await Document.getInitialProps(ctx)
    return { ...initialProps }
  }

  render() {
    return (
      <Html lang="en">
        <Head>
          {/* Common meta */}
          <meta
            name="description"
            content="Buy and sell second-hand items in the Western community."
          />
          <meta name="application-name" content="Usual & Unusual" />
          <meta
            name="apple-mobile-web-app-status-bar-style"
            content="default"
          />
          <meta name="apple-mobile-web-app-title" content="Usual & Unusual" />
          <meta name="format-detection" content="telephone=no" />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta
            name="msapplication-config"
            content="/static/icons/browserconfig.xml"
          />
          <meta name="msapplication-TileColor" content="#5468ff" />
          <meta name="msapplication-tap-highlight" content="no" />
          <meta name="theme-color" content="#5468ff" />

          {/* Icons */}
          <link
            rel="apple-touch-icon"
            href="/static/icons/apple-touch-icon.png"
          />
          <link
            rel="icon"
            type="image/svg+xml"
            sizes="any"
            href="/static/icons/uu-favicon.svg"
          />
          <link
            rel="mask-icon"
            href="/static/icons/safari-pinned-tab.svg"
            color="#5468ff"
          />
          <link rel="manifest" href="/static/icons/manifest.json" />

          {/* OG meta */}
          <meta property="og:type" content="website" />
          <meta property="og:title" content="Usual & Unusual" />
          <meta
            property="og:description"
            content="Buy and sell second-hand items in the Western community."
          />
          <meta property="og:site_name" content="Usual & Unusual" />

          {/* Twitter meta */}
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="Usual & Unusual" />
          <meta
            name="twitter:description"
            content="Buy and sell second-hand items in the Western community."
          />

          {/* Fonts */}
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" />
          <link
            href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"
            rel="stylesheet"
          />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    )
  }
}
