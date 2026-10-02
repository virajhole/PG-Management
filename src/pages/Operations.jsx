import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Badge, Tabs, Field, Input, Select, Textarea, EmptyState, BottomSheet, Button } from '../components/ui.jsx';
import { EmptyState as LegacyEmpty } from '../components/States.jsx';
import { Wrench as WrenchIcon, Megaphone as MegaphoneIcon, UserCheck as UserCheckIcon, ClipboardList as ClipboardListIcon, Plus as PlusIcon, Trash2 as TrashIcon, Send as SendIcon, MessageCircle as MessageIcon, Phone as PhoneIcon } from 'lucide-react';
import {
  listComplaints,
  createComplaint,
  updateComplaint,
  deleteComplaint,
  listNotices,
  createNotice,
  deleteNotice,
  listEnquiries,
  createEnquiry,
  updateEnquiry,
  deleteEnquiry,
  listVisitors,
  createVisitor,
  updateVisitor,
  deleteVisitor,
  COMPLAINT_CATEGORIES,
  COMPLAINT_PRIORITIES,
  ENQUIRY_STATUSES,
} from '../services/operationsService.js';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { dayjs, todayISO, formatDate } from '../utils/dateLogic.js';
import { waLink } from '../utils/whatsapp.js';

const TABS = [
  { value: 'complaints', label: 'Complaints', icon: WrenchIcon },
  { value: 'notices', label: 'Notices', icon: MegaphoneIcon },
  { value: 'enquiries', label: 'Enquiries', icon: UserCheckIcon },
  { value: 'visitors', label: 'Visitors', icon: ClipboardListIcon },
];

const STATUS_TONES = {
  open: 'danger',
  in_progress: 'warning',
  resolved: 'accent',
  new: 'brand',
  contacted: 'brand',
  visited: 'brand',
  joined: 'accent',
  lost: 'neutral',
};

function statusLabel(s) {
  return String(s || '').replace('_', ' ');
}

// ------------------------------------------------------------ complaints

function ComplaintSheet({ open, onClose, onSave, rooms }) {
  const [form, setForm] = useState({ title: '', category: 'electricity', priority: 'medium', roomNo: '', description: '', assignedTo: '' });
  const toast = useToast();

  function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Give the complaint a short title.');
      return;
    }
    onSave(form);
    setForm({ title: '', category: 'electricity', priority: 'medium', roomNo: '', description: '', assignedTo: '' });
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Log a complaint">
      <form onSubmit={submit} className="space-y-3">
        <Field id="cmp-title" label="Title" required>
          <Input id="cmp-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Fan not working" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="cmp-cat" label="Category">
            <Select id="cmp-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {COMPLAINT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field id="cmp-pri" label="Priority">
            <Select id="cmp-pri" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {COMPLAINT_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="cmp-room" label="Room">
            <Select id="cmp-room" value={form.roomNo} onChange={(e) => setForm({ ...form, roomNo: e.target.value })}>
              <option value="">—</option>
              {(rooms ?? []).map((r) => (
                <option key={r.id} value={r.roomNo}>{r.roomNo}</option>
              ))}
            </Select>
          </Field>
          <Field id="cmp-assigned" label="Assigned to">
            <Input id="cmp-assigned" value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} placeholder="Plumber / electrician" />
          </Field>
        </div>
        <Field id="cmp-desc" label="Details">
          <Textarea id="cmp-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What exactly is broken?" />
        </Field>
        <Button type="submit" variant="gradient" className="w-full">Save complaint</Button>
      </form>
    </BottomSheet>
  );
}

function ComplaintsTab({ complaints, rooms, onCreate, onUpdate, onDelete }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const toast = useToast();

  const counts = useMemo(
    () => ({
      all: complaints.length,
      open: complaints.filter((c) => c.status === 'open').length,
      in_progress: complaints.filter((c) => c.status === 'in_progress').length,
      resolved: complaints.filter((c) => c.status === 'resolved').length,
    }),
    [complaints],
  );

  const shown = useMemo(
    () => complaints.filter((c) => filter === 'all' || c.status === filter).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [complaints, filter],
  );

  async function advance(c) {
    const next = c.status === 'open' ? 'in_progress' : c.status === 'in_progress' ? 'resolved' : 'open';
    try {
      await onUpdate(c.id, { status: next, resolvedDate: next === 'resolved' ? todayISO() : null });
      toast.success(`Complaint marked ${statusLabel(next)}.`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {['all', 'open', 'in_progress', 'resolved'].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`chip ${filter === key ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-raised text-ink-muted'}`}
            >
              {statusLabel(key)} <span className="text-[10px] font-bold opacity-70">{counts[key]}</span>
            </button>
          ))}
        </div>
        <Button size="sm" variant="gradient" onClick={() => setSheetOpen(true)}>
          <PlusIcon className="size-4" /> New
        </Button>
      </div>

      {shown.length === 0 ? (
        <LegacyEmpty icon={WrenchIcon} title="No complaints" message="Log maintenance issues here so nothing gets forgotten." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((c) => (
            <li key={c.id}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{c.title}</p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      {c.roomNo ? `Room ${c.roomNo} · ` : ''}
                      {c.category} · {c.priority} priority
                    </p>
                  </div>
                  <Badge tone={STATUS_TONES[c.status]}>{statusLabel(c.status)}</Badge>
                </div>
                {c.description && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-muted">{c.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  {c.status !== 'resolved' && (
                    <Button size="sm" variant="secondary" onClick={() => advance(c)}>
                      {c.status === 'open' ? 'Start work' : 'Mark resolved'}
                    </Button>
                  )}
                  {c.assignedTo && <Badge tone="neutral">→ {c.assignedTo}</Badge>}
                  <span className="ml-auto text-[11px] text-ink-subtle">{formatDate(c.createdAt)}</span>
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    className="rounded-lg p-2 text-ink-subtle hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                    aria-label={`Delete complaint ${c.title}`}
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <ComplaintSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onSave={onCreate} rooms={rooms} />
    </div>
  );
}

// --------------------------------------------------------------- notices

function NoticeSheet({ open, onClose, onSave }) {
  const [form, setForm] = useState({ title: '', body: '', date: todayISO() });

  function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSave(form);
    setForm({ title: '', body: '', date: todayISO() });
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Post a notice">
      <form onSubmit={submit} className="space-y-3">
        <Field id="ntc-title" label="Title" required>
          <Input id="ntc-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </Field>
        <Field id="ntc-body" label="Message">
          <Textarea id="ntc-body" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4} />
        </Field>
        <Field id="ntc-date" label="Date">
          <Input id="ntc-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Button type="submit" variant="gradient" className="w-full">Post notice</Button>
      </form>
    </BottomSheet>
  );
}

function NoticesTab({ notices, tenants, onCreate, onDelete }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  function broadcastLink(notice) {
    const message = `📢 ${notice.title}\n\n${notice.body}\n\n— PG Management`;
    // WhatsApp has no web broadcast endpoint; the link opens a chat per tenant.
    return waLink(tenants[0]?.mobile ?? '', message);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="gradient" onClick={() => setSheetOpen(true)}>
          <PlusIcon className="size-4" /> New notice
        </Button>
      </div>
      {notices.length === 0 ? (
        <LegacyEmpty icon={MegaphoneIcon} title="No notices posted" message="Announce maintenance windows, rules or events to your tenants." />
      ) : (
        <ul className="space-y-3">
          {notices
            .slice()
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
            .map((n) => (
              <li key={n.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink">{n.title}</p>
                      <p className="text-[11px] text-ink-subtle">{formatDate(n.date)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDelete(n.id)}
                      className="rounded-lg p-2 text-ink-subtle hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      aria-label={`Delete notice ${n.title}`}
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </div>
                  {n.body && <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink-muted">{n.body}</p>}
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                    {tenants.slice(0, 1).map((t) => (
                      <a
                        key={t.id}
                        href={broadcastLink(n)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary min-h-9 px-3 text-xs"
                        title={`Open WhatsApp with this notice for ${t.name}`}
                      >
                        <SendIcon className="size-3.5" /> WhatsApp
                      </a>
                    ))}
                    {tenants.length > 1 && (
                      <span className="self-center text-[11px] text-ink-subtle">Opens per tenant — tap a tenant below to share with others.</span>
                    )}
                  </div>
                  {tenants.length > 1 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {tenants.slice(0, 8).map((t) => (
                        <a
                          key={t.id}
                          href={waLink(t.mobile, `📢 ${n.title}\n\n${n.body}\n\n— PG Management`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="chip border-line text-[11px] text-ink-muted"
                        >
                          {t.name.split(' ')[0]}
                        </a>
                      ))}
                    </div>
                  )}
                </Card>
              </li>
            ))}
        </ul>
      )}
      <NoticeSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onSave={onCreate} />
    </div>
  );
}

// -------------------------------------------------------------- enquiries

function EnquirySheet({ open, onClose, onSave }) {
  const [form, setForm] = useState({ name: '', phone: '', preferredSharing: 3, budget: '', expectedJoinDate: '', note: '' });

  function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;
    onSave(form);
    setForm({ name: '', phone: '', preferredSharing: 3, budget: '', expectedJoinDate: '', note: '' });
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Record an enquiry">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field id="enq-name" label="Name" required>
            <Input id="enq-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field id="enq-phone" label="Phone" required>
            <Input id="enq-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="enq-sharing" label="Preferred sharing">
            <Select id="enq-sharing" value={form.preferredSharing} onChange={(e) => setForm({ ...form, preferredSharing: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}-sharing</option>
              ))}
            </Select>
          </Field>
          <Field id="enq-budget" label="Budget (₹/month)">
            <Input id="enq-budget" type="number" min="0" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
          </Field>
        </div>
        <Field id="enq-join" label="Expected join date">
          <Input id="enq-join" type="date" value={form.expectedJoinDate} onChange={(e) => setForm({ ...form, expectedJoinDate: e.target.value })} />
        </Field>
        <Field id="enq-note" label="Note">
          <Input id="enq-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <Button type="submit" variant="gradient" className="w-full">Save enquiry</Button>
      </form>
    </BottomSheet>
  );
}

function EnquiriesTab({ enquiries, onCreate, onUpdate, onDelete }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="gradient" onClick={() => setSheetOpen(true)}>
          <PlusIcon className="size-4" /> New enquiry
        </Button>
      </div>
      {enquiries.length === 0 ? (
        <LegacyEmpty icon={UserCheckIcon} title="No enquiries yet" message="Track walk-ins and calls so nobody falls through the cracks." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {enquiries
            .slice()
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
            .map((enq) => (
              <li key={enq.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{enq.name}</p>
                      <p className="text-xs text-ink-subtle">
                        {enq.preferredSharing}-sharing · budget ₹{Number(enq.budget).toLocaleString('en-IN')}
                        {enq.expectedJoinDate ? ` · from ${formatDate(enq.expectedJoinDate)}` : ''}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONES[enq.status]}>{enq.status}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <Select
                      aria-label={`Status for ${enq.name}`}
                      value={enq.status}
                      onChange={(e) => onUpdate(enq.id, { status: e.target.value })}
                      className="min-h-9 w-auto py-1 text-xs"
                    >
                      {ENQUIRY_STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </Select>
                    <a href={waLink(enq.phone, `Hello ${enq.name.split(' ')[0]}, following up on your PG enquiry.`)} target="_blank" rel="noopener noreferrer" className="btn-ghost min-h-9 px-2 text-xs">
                      <MessageIcon className="size-4" />
                    </a>
                    <a href={`tel:${enq.phone}`} className="btn-ghost min-h-9 px-2 text-xs" aria-label={`Call ${enq.name}`}>
                      <PhoneIcon className="size-4" />
                    </a>
                    {enq.status !== 'joined' && (
                      <Button size="sm" variant="secondary" onClick={() => navigate(`/admission?fromEnquiry=${enq.id}`)} className="ml-auto">
                        Convert
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(enq.id)}
                      className="rounded-lg p-2 text-ink-subtle hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      aria-label={`Delete enquiry ${enq.name}`}
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </div>
                </Card>
              </li>
            ))}
        </ul>
      )}
      <EnquirySheet open={sheetOpen} onClose={() => setSheetOpen(false)} onSave={onCreate} />
    </div>
  );
}

// --------------------------------------------------------------- visitors

function VisitorSheet({ open, onClose, onSave, tenants }) {
  const [form, setForm] = useState({ name: '', phone: '', visitingWhom: '', purpose: '', inTime: '' });

  function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave({ ...form, date: todayISO(), inTime: form.inTime || dayjs().format('HH:mm') });
    setForm({ name: '', phone: '', visitingWhom: '', purpose: '', inTime: '' });
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Log a visitor">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field id="vis-name" label="Visitor name" required>
            <Input id="vis-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field id="vis-phone" label="Phone">
            <Input id="vis-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
        </div>
        <Field id="vis-whom" label="Visiting whom">
          <Select id="vis-whom" value={form.visitingWhom} onChange={(e) => setForm({ ...form, visitingWhom: e.target.value })}>
            <option value="">—</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.name}>{t.name} {t.roomNo ? `· Room ${t.roomNo}` : ''}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="vis-purpose" label="Purpose">
            <Input id="vis-purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Family visit, delivery…" />
          </Field>
          <Field id="vis-in" label="In time">
            <Input id="vis-in" type="time" value={form.inTime} onChange={(e) => setForm({ ...form, inTime: e.target.value })} />
          </Field>
        </div>
        <Button type="submit" variant="gradient" className="w-full">Log visitor</Button>
      </form>
    </BottomSheet>
  );
}

function VisitorsTab({ visitors, tenants, onCreate, onUpdate, onDelete }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const todayVisitors = useMemo(() => visitors.filter((v) => v.date === todayISO()), [visitors]);
  const pastVisitors = useMemo(() => visitors.filter((v) => v.date !== todayISO()).sort((a, b) => String(b.date).localeCompare(String(a.date))), [visitors]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-title">Today · {todayVisitors.length}</h2>
        <Button size="sm" variant="gradient" onClick={() => setSheetOpen(true)}>
          <PlusIcon className="size-4" /> Log visitor
        </Button>
      </div>
      {todayVisitors.length === 0 ? (
        <LegacyEmpty icon={ClipboardListIcon} title="No visitors today" message="Log every visitor at the gate for security." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {todayVisitors.map((v) => (
            <li key={v.id}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{v.name}</p>
                    <p className="text-xs text-ink-subtle">
                      {v.visitingWhom ? `Visiting ${v.visitingWhom}` : ''}
                      {v.purpose ? ` · ${v.purpose}` : ''}
                    </p>
                  </div>
                  <Badge tone={v.outTime ? 'accent' : 'warning'}>{v.outTime ? `Out ${v.outTime}` : `In ${v.inTime}`}</Badge>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                  {!v.outTime && (
                    <Button size="sm" variant="secondary" onClick={() => onUpdate(v.id, { outTime: dayjs().format('HH:mm') })}>
                      Mark out
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(v.id)}
                    className="ml-auto rounded-lg p-2 text-ink-subtle hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                    aria-label={`Delete visitor ${v.name}`}
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {pastVisitors.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-bold tracking-widest text-ink-subtle uppercase">Earlier</h3>
          <ul className="space-y-1.5">
            {pastVisitors.slice(0, 10).map((v) => (
              <li key={v.id}>
                <Card className="flex min-h-11 items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-ink">{v.name} <span className="text-ink-subtle">· {v.visitingWhom || '—'}</span></span>
                  <span className="shrink-0 text-xs text-ink-subtle">{formatDate(v.date)}</span>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
      <VisitorSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onSave={onCreate} tenants={tenants} />
    </div>
  );
}

// ------------------------------------------------------------------ page

export default function Operations() {
  const [params, setParams] = useSearchParams();
  const { customers, rooms } = useData();
  // The context guarantees an array; the fallback keeps the complaint sheet
  // safe even if a caller passes something else.
  const roomList = Array.isArray(rooms) ? rooms : [];
  const toast = useToast();
  const tab = params.get('tab') ?? 'complaints';

  const [complaints, setComplaints] = useState([]);
  const [notices, setNotices] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [visitors, setVisitors] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listComplaints(), listNotices(), listEnquiries(), listVisitors()])
      .then(([c, n, e, v]) => {
        if (cancelled) return;
        setComplaints(c);
        setNotices(n);
        setEnquiries(e);
        setVisitors(v);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tenants = useMemo(() => customers.filter((c) => c.status !== 'vacated'), [customers]);

  async function run(action, successMessage) {
    try {
      await action();
      if (successMessage) toast.success(successMessage);
    } catch (err) {
      toast.error(err.message || 'Something went wrong.');
    }
  }

  if (failed) {
    return (
      <EmptyState
        icon={WrenchIcon}
        title="Operations tables not found"
        message="Run the 003_operations.sql migration in your Supabase project to enable complaints, notices, enquiries and the visitor log."
      />
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">Operations</h1>
        <p className="mt-0.5 text-sm text-ink-subtle">Complaints, notices, enquiries and the visitor log.</p>
      </header>

      <Tabs tabs={TABS} active={tab} onChange={(v) => setParams(v === 'complaints' ? {} : { tab: v })} />

      {!loaded ? (
        <p className="py-10 text-center text-sm text-ink-subtle">Loading…</p>
      ) : tab === 'complaints' ? (
        <ComplaintsTab
          complaints={complaints}
          rooms={roomList}
          onCreate={(form) => run(() => createComplaint(form).then((created) => setComplaints((list) => [created, ...list])), 'Complaint logged.')}
          onUpdate={(id, patch) => run(() => updateComplaint(id, patch).then((updated) => setComplaints((list) => list.map((c) => (c.id === id ? updated : c)))))}
          onDelete={(id) => run(() => deleteComplaint(id).then(() => setComplaints((list) => list.filter((c) => c.id !== id))), 'Complaint deleted.')}
        />
      ) : tab === 'notices' ? (
        <NoticesTab
          notices={notices}
          tenants={tenants}
          onCreate={(form) => run(() => createNotice(form).then((created) => setNotices((list) => [created, ...list])), 'Notice posted.')}
          onDelete={(id) => run(() => deleteNotice(id).then(() => setNotices((list) => list.filter((n) => n.id !== id))), 'Notice deleted.')}
        />
      ) : tab === 'enquiries' ? (
        <EnquiriesTab
          enquiries={enquiries}
          onCreate={(form) => run(() => createEnquiry(form).then((created) => setEnquiries((list) => [created, ...list])), 'Enquiry saved.')}
          onUpdate={(id, patch) => run(() => updateEnquiry(id, patch).then((updated) => setEnquiries((list) => list.map((e) => (e.id === id ? updated : e)))))}
          onDelete={(id) => run(() => deleteEnquiry(id).then(() => setEnquiries((list) => list.filter((e) => e.id !== id))), 'Enquiry deleted.')}
        />
      ) : (
        <VisitorsTab
          visitors={visitors}
          tenants={tenants}
          onCreate={(form) => run(() => createVisitor(form).then((created) => setVisitors((list) => [created, ...list])), 'Visitor logged.')}
          onUpdate={(id, patch) => run(() => updateVisitor(id, patch).then((updated) => setVisitors((list) => list.map((v) => (v.id === id ? updated : v)))))}
          onDelete={(id) => run(() => deleteVisitor(id).then(() => setVisitors((list) => list.filter((v) => v.id !== id))), 'Visitor entry removed.')}
        />
      )}
    </div>
  );
}
