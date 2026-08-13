const KITTY_GRAPHICS_APC = "\x1b_G";

export function isEmulatorGeneratedProtocolReply(data: string): boolean {
  return data.includes(KITTY_GRAPHICS_APC);
}
