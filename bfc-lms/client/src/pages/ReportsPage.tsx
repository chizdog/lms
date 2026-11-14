import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, FileSpreadsheet, FileText, Filter } from 'lucide-react';
import { api, queryString, downloadFile } from '@/lib/api';
import type { ReportResult, ReportType, ReportColumn, Course, Department, Branch, Employee, Paginated } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { formatDate, formatDateTime, formatNumber, titleCase } from '@/lib/format';
import { PageHeader, Card, Button, LoadingBlock, EmptyState, Field, Input, Select } from '@/components/ui';

const PERCENT_KEY = /Rate|Progress|percentage|avgScore|passRate|Score$/i;

function renderCell(col: ReportColumn, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    const isPercent = col.label.includes('%') || PERCENT_KEY.test(col.key);
    return isPercent ? `${value}%` : formatNumber(value);
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatDate(text);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)) return formatDateTime(text);
  return text;
}

function isNumericCol(col: ReportColumn, rows: Record<string, unknown>[]): boolean {
  return rows.some((r) => typeof r[col.key] === 'number');
}

export function ReportsPage() {
  const { has } = useAuth();
  const toast = useToast();
  const canExport = has('report.export');

  const [type, setType] = useState('completion');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [employeeId, setEmployeeId] = useState('');

  const { data: types } = useQuery({ queryKey: ['report-types'], queryFn: () => api.get<{ items: ReportType[] }>('/reports/types') });
  const { data: depts } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[] }>('/departments') });
  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: () => api.get<{ items: Branch[] }>('/branches') });
  const { data: courses } = useQuery({ queryKey: ['courses', 'report-picker'], queryFn: () => api.get<Paginated<Course>>('/courses/?pageSize=200') });
  const { data: employees } = useQuery({ queryKey: ['employees', 'report-picker'], queryFn: () => api.get<Paginated<Employee>>('/employees/?pageSize=200') });

  const filters = { dateFrom, dateTo, departmentId, branchId, courseId, employeeId };
  const query = queryString({ ...filters, format: 'json' });
  const { data: report, isLoading, isFetching } = useQuery({
    queryKey: ['report', type, query],
    queryFn: () => api.get<ReportResult>(`/reports/${type}${query}`),
  });

  const activeType = types?.items.find((t) => t.type === type);

  async function exportAs(format: 'csv' | 'xlsx' | 'pdf') {
    try {
      await downloadFile(`/reports/${type}${queryString({ ...filters, format })}`, `bfc-${type}.${format}`);
      toast.success(`Report exported as ${format.toUpperCase()}`);
    } catch (e) { toast.error((e as Error).message); }
  }

  function resetFilters() { setDateFrom(''); setDateTo(''); setDepartmentId(''); setBranchId(''); setCourseId(''); setEmployeeId(''); }

  const rows = report?.rows ?? [];
  const columns = report?.columns ?? [];

  return (
    <div>
      <PageHeader title="Reports & Analytics" subtitle="Training insights across employees, departments and courses."
        actions={canExport ? <>
          <Button variant="outline" size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => void exportAs('csv')}>CSV</Button>
          <Button variant="outline" size="sm" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => void exportAs('xlsx')}>Excel</Button>
          <Button variant="gold" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => void exportAs('pdf')}>PDF</Button>
        </> : undefined} />

      <Card className="mb-5 p-4">
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Field label="Report">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {(types?.items ?? []).map((t) => <option key={t.type} value={t.type}>{t.title}</option>)}
            </Select>
            {activeType && <p className="mt-2 text-xs leading-relaxed text-ink-400">{activeType.description}</p>}
          </Field>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label mb-0 flex items-center gap-1.5"><Filter className="h-3.5 w-3.5" /> Filters</span>
              <button onClick={resetFilters} className="text-xs font-semibold text-ink-400 hover:text-gold-600">Reset</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="From"><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
              <Field label="To"><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
              <Field label="Department"><Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">All</option>{(depts?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select></Field>
              <Field label="Branch"><Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">All</option>{(branches?.items ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select></Field>
              <Field label="Course"><Select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">All</option>{(courses?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </Select></Field>
              <Field label="Employee"><Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">All</option>{(employees?.items ?? []).map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
              </Select></Field>
            </div>
          </div>
        </div>
      </Card>

      {isLoading ? <Card><LoadingBlock label="Building report…" /></Card> : !report ? (
        <Card><EmptyState title="Report unavailable" icon={<BarChart3 className="h-7 w-7" />} /></Card>
      ) : (
        <div className="space-y-5">
          {Object.keys(report.summary).length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(report.summary).map(([key, value]) => (
                <Card key={key} className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">{titleCase(key)}</p>
                  <p className="mt-1.5 text-2xl font-bold text-ink-950">
                    {typeof value === 'number' ? (PERCENT_KEY.test(key) ? `${value}%` : formatNumber(value)) : String(value)}
                  </p>
                </Card>
              ))}
            </div>
          )}

          <Card>
            <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
              <h3 className="flex items-center gap-2 text-sm font-bold text-ink-900"><BarChart3 className="h-4 w-4 text-gold-500" />{report.title}</h3>
              <span className="text-xs text-ink-400">{isFetching ? 'Refreshing…' : `${rows.length} row${rows.length === 1 ? '' : 's'}`}</span>
            </div>
            {rows.length === 0 ? (
              <EmptyState title="No data for these filters" message="Try widening the date range or clearing filters." icon={<BarChart3 className="h-7 w-7" />} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-ink-100 bg-ink-50/50 text-left">
                    {columns.map((c) => <th key={c.key} className={`th whitespace-nowrap ${isNumericCol(c, rows) ? 'text-right' : ''}`}>{c.label}</th>)}
                  </tr></thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className="border-b border-ink-50 last:border-0 hover:bg-ink-50/50">
                        {columns.map((c) => (
                          <td key={c.key} className={`td whitespace-nowrap ${isNumericCol(c, rows) ? 'text-right font-medium text-ink-700' : 'text-ink-600'}`}>{renderCell(c, row[c.key])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}