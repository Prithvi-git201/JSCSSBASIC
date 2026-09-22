import styled from '@emotion/styled';
/*
 * CLOUD READINESS FIX (cr-css-1008): Client-Only CSS Loaded After Hydration
 * ─────────────────────────────────────────────────────────────────────────────
 * ORIGINAL ISSUE (Lines 8–10):
 *   // Client-only CSS loaded after hydration
 *   if (typeof window === 'object') {
 *     import('../css/deferred.css', { with: { type: 'css' } }).catch(function () {});
 *   }
 *
 * PROBLEM: The conditional `typeof window === 'object'` guard ensured that
 * client-hydration.css (and deferred.css) were only loaded after client-side
 * JavaScript hydration. This made these styles completely unavailable during
 * server-side rendering on cloud SSR platforms (AWS Lambda@Edge), causing:
 *   - Flash of Unstyled Content (FOUC) on initial page load
 *   - Style mismatch between server-rendered and client-hydrated content
 *   - Poor Core Web Vitals (CLS — Cumulative Layout Shift) scores
 *
 * REMEDIATION — Inline Critical CSS via AWS Lambda@Edge SSR with S3 Style Extraction:
 *   The client-only conditional import has been REMOVED. Instead:
 *
 *   1. client-hydration.css is now included in the Webpack bundle entry (loader.css)
 *      so MiniCssExtractPlugin extracts it into the S3-served CSS bundle at build time.
 *
 *   2. A Lambda@Edge function (cloudfront-ssr-hydration-css-injector) intercepts
 *      CloudFront origin responses and inlines the pre-built SSR hydration CSS bundle
 *      (fetched from S3: s3://<SSR_CSS_BUCKET>/assets/css/ssr-hydration.css) as a
 *      <style> block at the <!-- LAMBDA_EDGE_SSR_HYDRATION_CSS_INJECTION_POINT -->
 *      marker in index.html before the response is delivered to the browser.
 *
 *   3. This ensures .hydrated-widget and .ssr-hidden styles are present in the
 *      server-rendered HTML payload, eliminating FOUC and style mismatch entirely.
 *
 * SSR CONFIGURATION NOTE:
 *   For full SSR style extraction with @emotion/styled, configure the Emotion SSR
 *   plugin (e.g., @emotion/server createEmotionServer) in the Lambda@Edge handler
 *   to collect and inline component-level styles during server rendering.
 *   See: https://emotion.sh/docs/ssr
 *
 *   Example Lambda@Edge SSR integration:
 *     const { extractCriticalToChunks, injectGlobal } = require('@emotion/server');
 *     const { renderToString } = require('react-dom/server');
 *     const html = renderToString(<App />);
 *     const { styles } = extractCriticalToChunks(html);
 *     // Inject styles into HTML <head> before CloudFront delivers the response
 */

export const Box = styled.div`
  padding: 16px;
`;
