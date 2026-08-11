import { useMemo } from "react";
import { MarkdownTextSpan } from "@/components/markdown-text";
import type { MathExpressionProps } from "./math-expression.types";

export function MathExpression({ expression, display, color }: MathExpressionProps) {
  const style = useMemo(() => ({ color }), [color]);
  return (
    <MarkdownTextSpan style={style}>
      {display ? `$$${expression}$$` : `$${expression}$`}
    </MarkdownTextSpan>
  );
}
