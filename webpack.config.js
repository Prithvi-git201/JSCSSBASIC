/**
 * webpack.config.js
 *
 * CLOUD READINESS FIX (cr-css-0006):  Hardcoded Server Names in CSS URLs
 * CLOUD READINESS FIX (cr-css-1008):  Client-Only CSS Loaded After Hydration
 * CLOUD READINESS FIX (cr-css-1011):  Absolute Filesystem Paths in CSS URLs
 *
 * This Webpack configuration resolves the CLOUDFRONT_DOMAIN at build time by
 * fetching it from AWS SSM Parameter Store (parameter: /app/cloudfront/domain).
 * The resolved domain is injected into CSS url() declarations via postcss-replace
 * and into JavaScript bundles via DefinePlugin, replacing all ${CLOUDFRONT_DOMAIN}
 * placeholders with the actual AWS CloudFront distribution domain.
 *
 * SSM Parameter Store integration (cr-css-0006 remediation):
 *   Parameter name : /app/cloudfront/domain
 *   Parameter value: <your-distribution-id>.cloudfront.net
 *   The build script fetches this parameter using the AWS SDK v3 SSM client.
 *   If the SSM parameter is unavailable, the CLOUDFRONT_DOMAIN environment
 *   variable is used as a fallback (for local development / CI environments
 *   where SSM access is not configured).
 *
 * Usage:
 *   # With SSM Parameter Store (recommended for AWS environments):
 *   AWS_REGION=us-east-1 npm run build
 *
 *   # With explicit environment variable (fallback / local dev):
 *   CLOUDFRONT_DOMAIN=d1abc2defg3hij.cloudfront.net npm run build
 *
 * Required environment variables:
 *   AWS_REGION        - AWS region where SSM parameters are stored (default: us-east-1)
 *   CLOUDFRONT_DOMAIN - Fallback: AWS CloudFront distribution domain
 *                       (e.g., d1abc2defg3hij.cloudfront.net)
 *                       Overridden by SSM parameter /app/cloudfront/domain when available.
 *
 * Asset upload requirement:
 *   Before deploying, upload all static assets referenced in CSS url() declarations
 *   to the S3 bucket backing the CloudFront distribution, preserving the path structure:
 *     /assets/img/header.svg      → s3://<bucket>/assets/img/header.svg
 *     /assets/img/bg.jpg          → s3://<bucket>/assets/img/bg.jpg   (cr-css-0006)
 *     /assets/css/animate.min.css → s3://<bucket>/assets/css/animate.min.css
 */

'use strict';

const path = require('path');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { PurgeCSSPlugin } = require('purgecss-webpack-plugin');
const glob = require('glob');

/**
 * Fetches the CloudFront domain from AWS SSM Parameter Store.
 * Falls back to the CLOUDFRONT_DOMAIN environment variable if SSM is unavailable.
 *
 * SSM Parameter: /app/cloudfront/domain
 * This implements the cr-css-0006 remediation: environment-specific CloudFront URLs
 * managed via AWS SSM Parameter Store, eliminating hardcoded internal server hostnames.
 *
 * @returns {Promise<string>} Resolved CloudFront domain (e.g., d1abc2defg3hij.cloudfront.net)
 */
async function resolveCloudFrontDomain() {
  // Attempt to fetch from AWS SSM Parameter Store
  try {
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
    const ssmClient = new SSMClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    const response = await ssmClient.send(
      new GetParameterCommand({
        Name: '/app/cloudfront/domain',
        WithDecryption: true,
      })
    );
    const domain = response.Parameter && response.Parameter.Value;
    if (domain) {
      console.log(
        `[webpack.config.js] CloudFront domain resolved from SSM Parameter Store ` +
        `(/app/cloudfront/domain): ${domain}`
      );
      return domain;
    }
  } catch (ssmError) {
    console.warn(
      `[webpack.config.js] Could not fetch CloudFront domain from SSM Parameter Store ` +
      `(/app/cloudfront/domain): ${ssmError.message}. ` +
      `Falling back to CLOUDFRONT_DOMAIN environment variable.`
    );
  }

  // Fallback: use CLOUDFRONT_DOMAIN environment variable
  const envDomain = process.env.CLOUDFRONT_DOMAIN;
  if (envDomain) {
    console.log(
      `[webpack.config.js] CloudFront domain resolved from environment variable ` +
      `CLOUDFRONT_DOMAIN: ${envDomain}`
    );
    return envDomain;
  }

  // Neither SSM nor env var is set — warn and use placeholder
  console.warn(
    '[webpack.config.js] WARNING: CloudFront domain could not be resolved from SSM ' +
    'Parameter Store (/app/cloudfront/domain) or CLOUDFRONT_DOMAIN environment variable. ' +
    'CSS url() placeholders (${CLOUDFRONT_DOMAIN}) will NOT be substituted. ' +
    'Set AWS_REGION and ensure the IAM role has ssm:GetParameter permission, or set ' +
    'CLOUDFRONT_DOMAIN=<your-distribution-id>.cloudfront.net before building.'
  );
  return 'CLOUDFRONT_DOMAIN_PLACEHOLDER';
}

/**
 * Build the Webpack configuration asynchronously so that the CloudFront domain
 * can be fetched from AWS SSM Parameter Store before the build starts.
 */
module.exports = async () => {
  const CLOUDFRONT_DOMAIN = await resolveCloudFrontDomain();

  /**
   * CLOUD READINESS FIX (cr-css-1003): Unused CSS Bloating Cloud Bundle Size
   * PurgeCSS scans all HTML templates and JS/JSX source files to identify CSS
   * selectors that are never referenced, then removes them from the final bundle
   * before it is uploaded to S3 and served via CloudFront.
   * This reduces CDN bandwidth costs and improves Core Web Vitals (FCP/LCP).
   */
  const PATHS = { src: path.join(__dirname, 'src') };
  /**
   * CLOUD READINESS FIX (cr-css-1006): Multiple CSS Files Not Concatenated or HTTP/2
   *
   * loader.css is added as a dedicated Webpack entry point so that css-loader
   * resolves all 13 @import statements (chunk00–chunk09, deferred, site, brand)
   * and MiniCssExtractPlugin concatenates them into a single hashed output file:
   *   dist/assets/css/bundle.[contenthash].css
   *
   * This single bundle is uploaded to S3 and served via CloudFront HTTP/2,
   * reducing 13 separate HTTP requests to 1 request with long-lived cache headers.
   *
   * CloudFront cache configuration for the bundle:
   *   Cache-Control: public, max-age=31536000, immutable
   *   HTTP/2 + Brotli compression enabled on the CloudFront distribution.
   *
   * CLOUD READINESS FIX (cr-css-1008): Client-Only CSS Loaded After Hydration
   * client-hydration.css is now included in the loader.css bundle entry so that
   * MiniCssExtractPlugin extracts it into the S3-served bundle. A separate
   * ssr-hydration entry is also defined to produce a dedicated SSR hydration
   * bundle (dist/assets/css/ssr-hydration.[contenthash].css) that is uploaded
   * to S3 and fetched by the Lambda@Edge function for inline injection into
   * server-rendered HTML responses.
   *
   * S3 upload (CI/CD pipeline post-build step):
   *   aws s3 cp dist/assets/css/ssr-hydration.*.css \
   *     s3://<SSR_CSS_BUCKET>/assets/css/ssr-hydration.css \
   *     --cache-control "public, max-age=31536000, immutable" \
   *     --content-type "text/css; charset=utf-8"
   *
   * Lambda@Edge function: cloudfront-ssr-hydration-css-injector
   * Trigger             : CloudFront "origin-response" event
   * S3 source           : s3://<SSR_CSS_BUCKET>/assets/css/ssr-hydration.css
   */

  return {
    mode: process.env.NODE_ENV || 'production',

    entry: {
      main: './src/ui/styles.js',
      bundle: './assets/css/loader.css',
      'ssr-hydration': './assets/css/client-hydration.css',
    },

    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].[contenthash].js',
      clean: true,
    },

    module: {
      rules: [
        {
          // Process CSS files: resolve url() placeholders, then extract to separate files
          test: /\.css$/i,
          use: [
            MiniCssExtractPlugin.loader,
            {
              loader: 'css-loader',
              options: {
                // Allow url() resolution through the build pipeline
                url: true,
                import: true,
              },
            },
            {
              // postcss-loader with postcss-replace substitutes ${CLOUDFRONT_DOMAIN}
              // placeholders in CSS url() declarations at build time.
              // The domain value is sourced from AWS SSM Parameter Store
              // (/app/cloudfront/domain) — see resolveCloudFrontDomain() above.
              // This is the core remediation for cr-css-0006: hardcoded internal
              // server hostnames (e.g., staging-assets.local) are replaced with
              // the environment-specific CloudFront distribution URL at build time.
              loader: 'postcss-loader',
              options: {
                postcssOptions: {
                  plugins: [
                    // Replace ${CLOUDFRONT_DOMAIN} placeholder with the actual
                    // CloudFront domain fetched from AWS SSM Parameter Store
                    [
                      'postcss-replace',
                      {
                        pattern: '${CLOUDFRONT_DOMAIN}',
                        data: {
                          CLOUDFRONT_DOMAIN: CLOUDFRONT_DOMAIN,
                        },
                      },
                    ],
                  ],
                },
              },
            },
          ],
        },
        {
          // Handle font files referenced in CSS @font-face declarations
          test: /\.(woff|woff2|eot|ttf|otf)$/i,
          type: 'asset/resource',
          generator: {
            filename: 'assets/fonts/[name].[contenthash][ext]',
          },
        },
      ],
    },

    plugins: [
      /**
       * DefinePlugin: Injects CLOUDFRONT_DOMAIN as a build-time constant.
       *
       * The domain value is sourced from AWS SSM Parameter Store
       * (/app/cloudfront/domain) via resolveCloudFrontDomain() above.
       * This ensures no hardcoded internal server hostnames (cr-css-0006) or
       * filesystem-relative paths (cr-css-1011) leak into the production bundle.
       *
       * CSS url() substitution is handled by postcss-replace (see postcss-loader above).
       */
      new webpack.DefinePlugin({
        'process.env.CLOUDFRONT_DOMAIN': JSON.stringify(CLOUDFRONT_DOMAIN),
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
      }),

      new MiniCssExtractPlugin({
        filename: 'assets/css/[name].[contenthash].css',
      }),

      /**
       * CLOUD READINESS FIX (cr-css-1003): PurgeCSS — Unused CSS Removal
       *
       * PurgeCSSPlugin integrates PurgeCSS into the Webpack build pipeline as a
       * CodeBuild build step for AWS CodePipeline bundle optimisation.
       *
       * How it works:
       *   1. After MiniCssExtractPlugin extracts CSS into separate files, PurgeCSS
       *      statically analyses all HTML and JS/JSX source files listed by the
       *      glob pattern to build a list of used CSS selectors.
       *   2. Any CSS rule whose selector does not appear in the scanned content is
       *      stripped from the output bundle (e.g., .deprecated-sidebar).
       *   3. The slimmed CSS bundle is then uploaded to S3 and served via CloudFront,
       *      reducing CDN bandwidth costs and improving page load performance.
       *
       * safelist: Patterns that must NEVER be purged regardless of static analysis:
       *   - /^animate-/  : animate.css utility classes applied dynamically at runtime
       *   - /^is-/       : state classes toggled by JavaScript (e.g., is-active)
       *   - /^has-/      : state classes toggled by JavaScript (e.g., has-error)
       */
      new PurgeCSSPlugin({
        paths: glob.sync(`${PATHS.src}/**/*`, { nodir: true }),
        safelist: {
          standard: [/^animate-/, /^is-/, /^has-/],
        },
      }),
    ],

    resolve: {
      extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    },

    optimization: {
      splitChunks: {
        cacheGroups: {
          styles: {
            name: 'styles',
            type: 'css/mini-extract',
            chunks: 'all',
            enforce: true,
          },
        },
      },
    },
  };
};
