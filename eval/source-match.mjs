// @ts-check

/**
 * Compare a deployed source URL with a root-relative evaluation expectation.
 *
 * A site base path may prefix the generated URL. The page suffix and heading
 * fragment must still match exactly.
 *
 * @param {string} actual
 * @param {string} expected
 */
export function sourceMatches(actual, expected) {
  const actualUrl = new URL(actual, "https://smgen.invalid");
  const expectedUrl = new URL(expected, "https://smgen.invalid");
  const pageMatches = actualUrl.pathname === expectedUrl.pathname
    || actualUrl.pathname.endsWith(expectedUrl.pathname);
  return pageMatches && actualUrl.hash === expectedUrl.hash;
}
