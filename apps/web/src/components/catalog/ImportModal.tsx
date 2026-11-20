import { useRef, useState, type ChangeEvent } from 'react';
import { CATALOG_IMPORT_COLUMNS, type CatalogImportResult } from '@cafeflow/shared';
import { Alert, Button, Field, Modal, Textarea } from '@cafeflow/ui';
import { api, errorMessage } from '../../lib/api';
import { formatCountFa } from '../../lib/format';

const SAMPLE_CSV = [
  CATALOG_IMPORT_COLUMNS.join(','),
  'نوشیدنی سرد,لیموناد,1200000,"لیمو و نعنا",بار,4,,true,true',
  'دسر,چیزکیک,1800000,,آشپزخانه,8,,true,true',
].join('\n');

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: (summary: CatalogImportResult['summary']) => void;
}

/**
 * Bulk menu import. The file is read in the browser and sent as plain text, so
 * the API needs no multipart parser. Nothing is written until the manager has
 * seen the per-row report: the first click is always a dry run.
 */
export function ImportModal({ open, onClose, onImported }: ImportModalProps) {
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<CatalogImportResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 300 * 1024) {
      setError('حجم فایل بیش از ۳۰۰ کیلوبایت است.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      setResult(null);
      setCsv(String(reader.result ?? ''));
    };
    reader.readAsText(file, 'utf-8');
  };

  const run = async (dryRun: boolean) => {
    if (csv.trim() === '') {
      setError('محتوای CSV را انتخاب یا جای‌گذاری کنید.');
      return;
    }
    setBusy(dryRun ? 'preview' : 'import');
    setError(null);
    try {
      const response = await api.post<CatalogImportResult>('/catalog/import', { csv, dryRun });
      setResult(response);
      if (!dryRun) onImported(response.summary);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const downloadSample = () => {
    const blob = new Blob([`\uFEFF${SAMPLE_CSV}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cafeflow-menu-sample.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ایمپورت منو از CSV"
      description="هر سطر یک محصول؛ دسته‌های تازه خودکار ساخته می‌شوند و محصول موجود با نام یکسان به‌روز می‌شود."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            بستن
          </Button>
          <Button variant="secondary" loading={busy === 'preview'} onClick={() => void run(true)}>
            پیش‌نمایش
          </Button>
          <Button loading={busy === 'import'} onClick={() => void run(false)}>
            ایمپورت
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-brand-400">
            انتخاب فایل CSV
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={pickFile} ref={fileInput} />
          </label>
          <Button size="sm" variant="ghost" onClick={downloadSample}>
            دانلود فایل نمونه
          </Button>
        </div>

        <Field
          label="محتوای CSV"
          hint={`سرستون‌ها: ${CATALOG_IMPORT_COLUMNS.join('، ')}. فقط category، name و price الزامی‌اند؛ متن دارای ویرگول را در "..." بگذارید.`}
        >
          <Textarea
            rows={6}
            dir="ltr"
            className="font-mono text-[11px]"
            value={csv}
            onChange={(event) => {
              setCsv(event.target.value);
              setResult(null);
            }}
            placeholder={`${CATALOG_IMPORT_COLUMNS.join(',')}\nنوشیدنی سرد,لیموناد,1200000`}
          />
        </Field>

        {result ? (
          <div className="space-y-3">
            <Alert tone={result.summary.errors > 0 ? 'warning' : 'success'} title="گزارش ایمپورت">
              {result.dryRun ? 'پیش‌نمایش بدون ذخیره: ' : 'ذخیره شد: '}
              {formatCountFa(result.summary.created)} محصول تازه،{' '}
              {formatCountFa(result.summary.updated)} به‌روزرسانی،{' '}
              {formatCountFa(result.summary.categoriesCreated)} دستهٔ تازه،{' '}
              {formatCountFa(result.summary.errors)} خطا.
            </Alert>

            <div className="max-h-64 overflow-y-auto rounded-2xl border border-line/80">
              <table className="w-full text-right text-[11px]">
                <thead className="bg-surface text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">سطر</th>
                    <th className="px-3 py-2 font-medium">محصول</th>
                    <th className="px-3 py-2 font-medium">دسته</th>
                    <th className="px-3 py-2 font-medium">نتیجه</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={`${row.line}-${row.nameFa}`} className="border-t border-line/60">
                      <td className="num px-3 py-1.5 text-muted">{formatCountFa(row.line)}</td>
                      <td className="px-3 py-1.5 text-ink">{row.nameFa}</td>
                      <td className="px-3 py-1.5 text-muted">{row.categoryNameFa || '—'}</td>
                      <td className="px-3 py-1.5">
                        {row.action === 'error' ? (
                          <span className="text-danger-700">{row.messageFa}</span>
                        ) : (
                          <span className={row.action === 'created' ? 'text-success-700' : 'text-brand-700'}>
                            {row.action === 'created' ? 'ساخته می‌شود / شد' : 'به‌روز می‌شود / شد'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
