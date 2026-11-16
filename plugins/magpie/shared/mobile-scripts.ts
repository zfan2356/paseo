// Magpie's lazy modules use literal import() paths. Native WebViews cannot
// attach the host's cookie to module loads, so resolve them through the RPC bridge.
export function bridgeModuleImports(source: string, from: string): string {
  return source.replace(
    /\bimport\(\s*(["'])([^"'\\]+)\1\s*\)/g,
    (_match, _quote, path) =>
      `window.__paseoMagpieImport(${JSON.stringify(new URL(path, from).href)})`,
  );
}
