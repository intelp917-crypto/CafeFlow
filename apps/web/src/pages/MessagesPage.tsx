import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Textarea,
  StatCard,
  type Column,
} from '@cafeflow/ui';
import {
  MESSAGE_CHANNELS,
  MESSAGE_CHANNEL_LABELS_FA,
  MESSAGE_STATUS_LABELS_FA,
  MESSAGE_STATUS_TONES,
  type MessageChannel,
  type MessageTemplateRow,
  type MessagesResponse,
  type OutboxRow,
} from '@cafeflow/shared';
import { api, errorMessage } from '../lib/api';
import { formatCountFa, formatDateTimeFa } from '../lib/format';

function parseVariables(value: string): Record<string, string> | undefined {
  const entries = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=');
      if (index <= 0) return null;
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function MessagesPage() {
  const [data, setData] = useState<MessagesResponse | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [sendForm, setSendForm] = useState({
    channel: 'sms' as Exclude<MessageChannel, 'inapp'>,
    templateKey: '',
    recipients: '',
    variables: '',
    bodyFa: '',
  });

  const [templateModal, setTemplateModal] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    key: '',
    channel: 'sms' as MessageChannel,
    titleFa: '',
    bodyFa: '',
  });

  const [failing, setFailing] = useState<OutboxRow | null>(null);
  const [failReason, setFailReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<MessagesResponse>(`/messages${status ? `?status=${status}` : ''}`);
      setData(response);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const templates = data?.templates ?? [];
  const channelTemplates = useMemo(
    () => templates.filter((template) => template.channel === sendForm.channel && template.isActive),
    [templates, sendForm.channel],
  );

  const send = async () => {
    const recipients = sendForm.recipients
      .split(/[\n,،;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (recipients.length === 0) {
      setError('حداقل یک گیرنده وارد کنید.');
      return;
    }
    if (!sendForm.templateKey && sendForm.bodyFa.trim().length < 2) {
      setError('یک قالب انتخاب کنید یا متن پیام را بنویسید.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.post<{ queued: number }>('/messages/send', {
        channel: sendForm.channel,
        templateKey: sendForm.templateKey || undefined,
        bodyFa: sendForm.templateKey ? undefined : sendForm.bodyFa,
        recipients,
        variables: parseVariables(sendForm.variables),
      });
      setNotice(`${formatCountFa(response.queued)} پیام در صف ارسال قرار گرفت.`);
      setSendForm({ ...sendForm, recipients: '', variables: '' });
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const createTemplate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<MessageTemplateRow>('/messages/templates', {
        key: templateForm.key.trim(),
        channel: templateForm.channel,
        titleFa: templateForm.titleFa,
        bodyFa: templateForm.bodyFa,
      });
      setTemplateModal(false);
      setTemplateForm({ key: '', channel: 'sms', titleFa: '', bodyFa: '' });
      setNotice('قالب پیام ساخته شد.');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggleTemplate = async (template: MessageTemplateRow) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/messages/templates/${template.id}`, { isActive: !template.isActive });
      setNotice(`قالب «${template.key}» ${template.isActive ? 'غیرفعال' : 'فعال'} شد.`);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const markSent = async (row: OutboxRow) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/messages/${row.id}/sent`);
      setNotice('ارسال پیام ثبت شد.');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const markFailed = async () => {
    if (!failing) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/messages/${failing.id}/failed`, { error: failReason });
      setFailing(null);
      setFailReason('');
      setNotice('خطای ارسال ثبت شد.');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const templateColumns: Column<MessageTemplateRow>[] = [
    { key: 'key', header: 'کلید', render: (row) => <span className="text-[11px]" dir="ltr">{row.key}</span> },
    { key: 'channel', header: 'کانال', render: (row) => <Badge tone="neutral">{row.channelLabelFa}</Badge> },
    { key: 'title', header: 'عنوان', render: (row) => <span className="text-xs">{row.titleFa}</span> },
    {
      key: 'body',
      header: 'متن',
      render: (row) => <span className="block max-w-xs truncate text-[11px] text-muted">{row.bodyFa}</span>,
    },
    {
      key: 'active',
      header: 'وضعیت',
      render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'فعال' : 'غیرفعال'}</Badge>,
    },
    {
      key: 'actions',
      header: 'عملیات',
      render: (row) => (
        <Button size="sm" variant="outline" onClick={() => void toggleTemplate(row)} disabled={busy}>
          {row.isActive ? 'غیرفعال' : 'فعال'}
        </Button>
      ),
    },
  ];

  const outboxColumns: Column<OutboxRow>[] = [
    { key: 'created', header: 'زمان', render: (row) => <span className="text-[11px]">{formatDateTimeFa(row.scheduledAt)}</span> },
    { key: 'channel', header: 'کانال', render: (row) => <Badge tone="neutral">{row.channelLabelFa}</Badge> },
    { key: 'recipient', header: 'گیرنده', render: (row) => <span className="num text-[11px]" dir="ltr">{row.recipient ?? '—'}</span> },
    {
      key: 'content',
      header: 'متن',
      render: (row) => (
        <div className="max-w-xs space-y-0.5">
          <p className="truncate text-[11px] text-ink">{row.titleFa ?? '—'}</p>
          <p className="truncate text-[10px] text-muted">{row.bodyFa ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'وضعیت',
      render: (row) => (
        <div className="space-y-0.5">
          <Badge tone={MESSAGE_STATUS_TONES[row.status]}>{row.statusLabelFa}</Badge>
          {row.lastError ? <p className="text-[9px] text-danger-600">{row.lastError}</p> : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'تأیید پل ارسال',
      render: (row) =>
        row.status === 'queued' || row.status === 'failed' ? (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => void markSent(row)} disabled={busy}>
              ارسال شد
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFailing(row)} disabled={busy}>
              خطا
            </Button>
          </div>
        ) : (
          <span className="text-[10px] text-muted">{row.sentAt ? formatDateTimeFa(row.sentAt) : '—'}</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="مرکز پیام"
        description="قالب‌های پیام و صف ارسال پیامک/اعلان. صف فقط ارسال را ثبت می‌کند؛ تأیید تحویل را پل ارسال ثبت می‌کند."
        breadcrumb="کافه‌فلو / پیام‌ها"
        actions={
          <Button size="sm" onClick={() => setTemplateModal(true)}>
            قالب جدید
          </Button>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading && !data ? (
        <Card className="flex justify-center py-16 text-brand-600">
          <Spinner size="lg" />
        </Card>
      ) : !data ? (
        <Card>
          <ErrorState message={error ?? 'داده‌ای دریافت نشد.'} onRetry={() => void load()} />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="در صف" value={formatCountFa(data.summary.queued)} tone="warning" />
            <StatCard label="ارسال‌شده" value={formatCountFa(data.summary.sent)} tone="success" />
            <StatCard label="ناموفق" value={formatCountFa(data.summary.failed)} tone="danger" />
          </div>

          <Card>
            <CardHeader
              title="ارسال پیام"
              description="گیرندگان را با کاما یا خط جدید جدا کنید. برای قالب، متغیرها را به شکل نام=مقدار وارد کنید."
            />
            <CardBody className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="کانال">
                  <select
                    value={sendForm.channel}
                    onChange={(event) =>
                      setSendForm({
                        ...sendForm,
                        channel: event.target.value as typeof sendForm.channel,
                        templateKey: '',
                      })
                    }
                    className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
                  >
                    <option value="sms">پیامک</option>
                    <option value="push">اعلان مرورگر</option>
                  </select>
                </Field>
                <Field label="قالب" hint="بدون قالب، متن دلخواه ارسال می‌شود.">
                  <select
                    value={sendForm.templateKey}
                    onChange={(event) => setSendForm({ ...sendForm, templateKey: event.target.value })}
                    className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
                  >
                    <option value="">متن دلخواه</option>
                    {channelTemplates.map((template) => (
                      <option key={template.id} value={template.key}>
                        {template.titleFa} ({template.key})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="گیرندگان" required hint="شماره موبایل یا شناسه دستگاه، جدا با کاما یا خط جدید.">
                <Textarea
                  value={sendForm.recipients}
                  onChange={(event) => setSendForm({ ...sendForm, recipients: event.target.value })}
                  placeholder={'09120000000\n09121111111'}
                />
              </Field>

              {sendForm.templateKey ? (
                <Field label="متغیرهای قالب" hint="هر خط یک متغیر: name=سارا">
                  <Textarea
                    value={sendForm.variables}
                    onChange={(event) => setSendForm({ ...sendForm, variables: event.target.value })}
                    placeholder={'name=سارا\ncode=CF-ABC123'}
                  />
                </Field>
              ) : (
                <Field label="متن پیام">
                  <Textarea
                    value={sendForm.bodyFa}
                    onChange={(event) => setSendForm({ ...sendForm, bodyFa: event.target.value })}
                  />
                </Field>
              )}

              <Button onClick={() => void send()} loading={busy} disabled={!sendForm.recipients.trim()}>
                افزودن به صف ارسال
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="قالب‌های پیام" description="متغیرها به شکل {{name}} در متن جای‌گذاری می‌شوند." />
            {templates.length > 0 ? (
              <DataTable columns={templateColumns} rows={templates} rowKey={(row) => row.id} />
            ) : (
              <EmptyState title="قالبی ثبت نشده است" />
            )}
          </Card>

          <Card>
            <CardHeader
              title="صف ارسال"
              description="ارسال واقعی به پل محلی سپرده می‌شود؛ بدون تأیید پل، پیامی «ارسال‌شده» نمایش داده نمی‌شود."
              action={
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink"
                  aria-label="فیلتر وضعیت"
                >
                  <option value="">همه وضعیت‌ها</option>
                  {Object.entries(MESSAGE_STATUS_LABELS_FA).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              }
            />
            {data.items.length > 0 ? (
              <DataTable columns={outboxColumns} rows={data.items} rowKey={(row) => row.id} />
            ) : (
              <EmptyState title="پیامی در صف نیست" />
            )}
          </Card>
        </>
      )}

      <Modal
        open={templateModal}
        onClose={() => setTemplateModal(false)}
        title="قالب پیام جدید"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTemplateModal(false)}>
              انصراف
            </Button>
            <Button
              onClick={() => void createTemplate()}
              loading={busy}
              disabled={!templateForm.key || !templateForm.titleFa || !templateForm.bodyFa}
            >
              ثبت
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="کلید" required hint="حروف کوچک انگلیسی و زیرخط">
            <Input
              value={templateForm.key}
              onChange={(event) => setTemplateForm({ ...templateForm, key: event.target.value })}
              dir="ltr"
              placeholder="order_ready"
            />
          </Field>
          <Field label="کانال" required>
            <select
              value={templateForm.channel}
              onChange={(event) =>
                setTemplateForm({ ...templateForm, channel: event.target.value as MessageChannel })
              }
              className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink"
            >
              {MESSAGE_CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {MESSAGE_CHANNEL_LABELS_FA[channel]}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="عنوان" required>
              <Input
                value={templateForm.titleFa}
                onChange={(event) => setTemplateForm({ ...templateForm, titleFa: event.target.value })}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="متن" required hint="مثال: {{name}} عزیز، سفارش {{code}} آماده است.">
              <Textarea
                value={templateForm.bodyFa}
                onChange={(event) => setTemplateForm({ ...templateForm, bodyFa: event.target.value })}
              />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(failing)}
        onClose={() => {
          setFailing(null);
          setFailReason('');
        }}
        title="ثبت خطای ارسال"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setFailing(null);
                setFailReason('');
              }}
            >
              انصراف
            </Button>
            <Button onClick={() => void markFailed()} loading={busy} disabled={failReason.trim().length < 2}>
              ثبت
            </Button>
          </div>
        }
      >
        <Field label="دلیل خطا" required hint={failing?.recipient ?? undefined}>
          <Input value={failReason} onChange={(event) => setFailReason(event.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
