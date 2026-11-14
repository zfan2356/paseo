export function sidebarMaterialColor(color: string): string {
  return `var(--paseo-sidebar-material, ${color})`;
}

export function materialMutedColor(color: string): string {
  return `var(--paseo-material-muted, ${color})`;
}

export function materialStatusColor(color: string, role: string): string {
  return `var(--paseo-status-${role}, ${color})`;
}

export function materialBorderColor(color: string): string {
  return `var(--paseo-structural-border, ${color})`;
}
