import { memo, useMemo, type CSSProperties } from "react";
import type { MathExpressionProps } from "./math-expression.types";
import { renderMathToMarkup } from "./math-rendering";

const inlineStyle: CSSProperties = {
  display: "inline-block",
  maxWidth: "100%",
  verticalAlign: "middle",
};

const blockStyle: CSSProperties = {
  display: "block",
  maxWidth: "100%",
  overflowX: "auto",
  paddingBlock: 8,
  textAlign: "center",
};

export const MathExpression = memo(function MathExpression({
  expression,
  display,
}: MathExpressionProps) {
  const markup = useMemo(() => renderMathToMarkup(expression, display), [display, expression]);
  const renderedMarkup = useMemo(() => ({ __html: markup }), [markup]);
  const Element = display ? "div" : "span";

  return (
    <Element
      aria-label={expression}
      data-paseo-math={display ? "block" : "inline"}
      style={display ? blockStyle : inlineStyle}
      dangerouslySetInnerHTML={renderedMarkup}
    />
  );
});
