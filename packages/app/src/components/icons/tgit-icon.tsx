import { SvgPathIcon, type SvgPathIconProps } from "./svg-path-icon";

export function TgitIcon(props: SvgPathIconProps) {
  return (
    <SvgPathIcon
      {...props}
      viewBox="0 0 24 24"
      path="M12 1 2.5 6.5v11L12 23l9.5-5.5v-11L12 1Zm0 2.3 7.5 4.3v8.8L12 20.7l-7.5-4.3V7.6L12 3.3ZM7 8h10v2h-4v7h-2v-7H7V8Z"
    />
  );
}
