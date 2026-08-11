import { MarkdownTextSpan } from "@/components/markdown-text";
import type { MathExpressionProps } from "./math-expression.types";

export function MathExpression({ expression, display }: MathExpressionProps) {
  return <MarkdownTextSpan>{display ? `$$${expression}$$` : `$${expression}$`}</MarkdownTextSpan>;
}
