type SessionPermission = "workspace.write" | "workspace.manage" | "hub.execute";

export function permitsSessionOperation(
  permissions: readonly string[] | undefined,
  permission: SessionPermission,
): boolean {
  // COMPAT(sessionPermissions): added in v0.15.3, remove after 2027-11-14; older daemons omit grants.
  return permissions === undefined || permissions.includes(permission);
}
