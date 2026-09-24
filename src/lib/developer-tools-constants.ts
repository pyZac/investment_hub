/**
 * The one and only `developer_tools_settings` row's id (seeded by
 * 20260924113142_add_developer_tools_settings/migration.sql). Shared
 * between withdrawal-guard.ts (reads the flag) and developer-tools.ts
 * (reads/writes it) so the literal exists in exactly one place — never
 * hardcode "singleton" at a second call site.
 */
export const DEVELOPER_TOOLS_SETTINGS_ID = "singleton";
