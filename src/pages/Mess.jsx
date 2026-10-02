import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Field, Input, Button } from '../components/ui.jsx';
import { useData } from '../context/DataContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { TABLES, listRows, upsertRows as upsertMessRows } from '../services/supabase.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MEALS = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
];

/**
 * Weekly mess menu editor. Optional feature: only meaningful when Settings →
 * "Mess enabled" is on, but the editor itself is harmless to show.
 */
export default function Mess() {
  const { settings, updateSettings } = useData();
  const toast = useToast();
  const [menu, setMenu] = useState({}); // { `${day}-${meal}`: { id, items } }
  const [loaded, setLoaded] = useState(false);
  const [charges, setCharges] = useState('');

  useEffect(() => {
    listRows(TABLES.messMenu)
      .then((rows) => {
        const map = {};
        for (const r of rows) map[`${r.day}-${r.meal}`] = r;
        setMenu(map);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    setCharges(settings.messCharges ? String(settings.messCharges) : '');
  }, [settings.messCharges]);

  const filledCount = useMemo(() => Object.values(menu).filter((m) => m.items?.trim()).length, [menu]);

  async function saveCell(day, meal, items) {
    const key = `${day}-${meal}`;
    const existing = menu[key];
    try {
      if (existing?.id) {
        const updated = await upsertMessRows([{ id: existing.id, day, meal, items }]);
        setMenu((m) => ({ ...m, [key]: updated[0] ?? { ...existing, items } }));
      } else {
        const updated = await upsertMessRows([{ day, meal, items }]);
        setMenu((m) => ({ ...m, [key]: updated[0] ?? { id: `mm_${Date.now()}`, day, meal, items } }));
      }
    } catch (err) {
      toast.error(err.message || 'Could not save the menu.');
    }
  }

  async function saveCharges() {
    try {
      await updateSettings({ ...settings, messCharges: Number(charges) || 0 });
      toast.success('Meal charges saved.');
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!loaded) {
    return <p className="py-10 text-center text-sm text-ink-subtle">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">Mess menu</h1>
          <p className="mt-0.5 text-sm text-ink-subtle">
            Weekly food plan {filledCount > 0 ? `· ${filledCount} meals filled` : '· nothing filled yet'}
          </p>
        </div>
        <Badge tone={settings.messEnabled ? 'accent' : 'neutral'}>{settings.messEnabled ? 'Mess on' : 'Mess off (Settings)'}</Badge>
      </header>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="mess-charges" label="Monthly meal charges (₹)" className="flex-1">
            <Input id="mess-charges" type="number" min="0" value={charges} onChange={(e) => setCharges(e.target.value)} placeholder="e.g. 3500" />
          </Field>
          <Button variant="secondary" onClick={saveCharges}>
            Save charges
          </Button>
        </div>
      </Card>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-1 text-left text-sm">
          <thead>
            <tr>
              <th className="w-16 px-2 text-xs font-bold tracking-wider text-ink-subtle uppercase">Day</th>
              {MEALS.map((m) => (
                <th key={m.value} className="px-2 text-xs font-bold tracking-wider text-ink-subtle uppercase">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day) => (
              <tr key={day}>
                <td className="px-2 py-1 text-sm font-bold text-ink">{day}</td>
                {MEALS.map((m) => {
                  const key = `${day}-${m.value}`;
                  const cell = menu[key];
                  return (
                    <td key={key} className="align-top">
                      <textarea
                        rows={2}
                        defaultValue={cell?.items ?? ''}
                        onBlur={(e) => {
                          if (e.target.value !== (cell?.items ?? '')) saveCell(day, m.value, e.target.value);
                        }}
                        placeholder="—"
                        aria-label={`${m.label} on ${day}`}
                        className="field-input min-h-16 py-1.5 text-xs"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-subtle">Edits save when a cell loses focus. Tenants see this menu on the notice board.</p>
    </div>
  );
}
