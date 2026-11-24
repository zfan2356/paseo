declare module "markdown-it-texmath" {
  import type MarkdownIt from "markdown-it";

  interface TexMathOptions {
    engine?: {
      renderToString(expression: string, options?: Record<string, unknown>): string;
    };
    delimiters?: string | string[];
    outerSpace?: boolean;
    katexOptions?: Record<string, unknown>;
  }

  function texmath(markdown: MarkdownIt, options?: TexMathOptions): void;

  export default texmath;
}
