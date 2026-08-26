import { getColumns } from '@flux/shared';

export function getStatusValidationError(projectId: string, status: unknown): string | null {
  const columns = getColumns(projectId);
  if (typeof status === 'string' && columns.some(column => column.id === status)) {
    return null;
  }
  const valid = columns.map(column => `${column.id} (${column.label})`).join(', ');
  return `Unknown status ${JSON.stringify(status)} for project ${projectId}. Valid columns: ${valid}.`;
}
