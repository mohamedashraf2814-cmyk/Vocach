const moneyFmt = new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat('ar-EG');

export const fmtMoney = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${moneyFmt.format(v)} ج.م`);
export const fmtNum = (v: number | null | undefined) => (v === null || v === undefined ? '—' : numFmt.format(v));

// التواريخ في قاعدة البيانات بصيغة "YYYY-MM-DD HH:MM:SS" بالتوقيت المحلي
function parse(v: string) {
  const s = v.includes('T') ? v : v.replace(' ', 'T');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDateTime(v?: string | null) {
  if (!v) return '—';
  const d = parse(v);
  if (!d) return v;
  return d.toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(v?: string | null) {
  if (!v) return '—';
  const d = parse(v.length === 10 ? `${v}T00:00:00` : v);
  if (!d) return v;
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function todayIso() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function monthStartIso() {
  return todayIso().slice(0, 8) + '01';
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

const pctFmt = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });
// نسبة العمولة من المبلغ
export const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${pctFmt.format(v)}٪`);
