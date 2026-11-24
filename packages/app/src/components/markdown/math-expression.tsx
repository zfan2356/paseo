import { useMemo } from "react";
import { Text } from "react-native";
import type { MathExpressionProps } from "./math-expression.types";

export function MathExpression({ expression, display, color }: MathExpressionProps) {
  const style = useMemo(() => ({ color }), [color]);
  return <Text style={style}>{display ? `$$${expression}$$` : `$${expression}$`}</Text>;
}
