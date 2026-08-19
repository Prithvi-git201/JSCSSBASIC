import styled from '@emotion/styled';
// No SSR style extraction configured (no ServerStyleSheet / SSR plugin)

export const Box = styled.div`
  padding: 16px;
`;

// Client-only CSS loaded after hydration
if (typeof window === 'object') {
  import('../css/deferred.css', { with: { type: 'css' } }).catch(function () {});
}
