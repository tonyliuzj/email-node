import '../styles/globals.css'
import Head from 'next/head'

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>{pageProps.siteTitle || 'Email Node'}</title>
      </Head>
      <Component {...pageProps} />
    </>
  )
}
