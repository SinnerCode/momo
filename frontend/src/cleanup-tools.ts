/** 数据管理的维护工具；首页入口、二级页和面包屑共用名称与地址。 */
import { CLEANUP_TOOL_PATHS } from './cleanup-routes';
import { t } from './i18n';

export { CLEANUP_HASH_REDIRECTS, type CleanupToolKey, type CleanupToolPath } from './cleanup-routes';
export const CLEANUP_TOOLS = [
  { key: 'organize', path: CLEANUP_TOOL_PATHS.organize, title: t('cleanup:tools.organize'), icon: 'folder-cog',
    description: t('cleanup:tools.organizeDescription') },
  { key: 'resource-sync', path: CLEANUP_TOOL_PATHS['resource-sync'], title: t('cleanup:tools.resourceSync'), icon: 'git-compare',
    description: t('cleanup:tools.resourceSyncDescription') },
  { key: 'orphan-records', path: CLEANUP_TOOL_PATHS['orphan-records'], title: t('cleanup:tools.orphanRecords'), icon: 'file-stack',
    description: t('cleanup:tools.orphanRecordsDescription') },
  { key: 'media-repair', path: CLEANUP_TOOL_PATHS['media-repair'], title: t('cleanup:tools.mediaRepair'), icon: 'wrench',
    description: t('cleanup:tools.mediaRepairDescription') },
  { key: 'links', path: CLEANUP_TOOL_PATHS.links, title: t('cleanup:tools.links'), icon: 'link',
    description: t('cleanup:tools.linksDescription') },
  { key: 'batch-delete', path: CLEANUP_TOOL_PATHS['batch-delete'], title: t('cleanup:tools.bulkDelete'), icon: 'trash',
    description: t('cleanup:tools.bulkDeleteDescription') },
] as const;

export type CleanupTool = typeof CLEANUP_TOOLS[number];

export const CLEANUP_CRUMB_PAGES = Object.fromEntries(CLEANUP_TOOLS.map(tool => [tool.path, tool.title]));
