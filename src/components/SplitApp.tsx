import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CircleDollarSign, Plus, ReceiptText, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

type Person = { id: string; name: string };
type Expense = { id: string; description: string; amount: number; payerId: string; participantIds: string[] };
type SavedState = { people: Person[]; expenses: Expense[] };
type WebTool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };

declare global {
  interface Document { modelContext?: { registerTool: (tool: WebTool, options?: { signal?: AbortSignal }) => void | Promise<void> } }
}

const initialPeople: Person[] = [
  { id: 'ana', name: 'Ana' }, { id: 'luis', name: 'Luis' },
  { id: 'maria', name: 'María' }, { id: 'diego', name: 'Diego' },
];
const initialExpenses: Expense[] = [
  { id: 'e1', description: 'Cena del viernes', amount: 1280, payerId: 'ana', participantIds: ['ana','luis','maria','diego'] },
  { id: 'e2', description: 'Gasolina', amount: 760, payerId: 'luis', participantIds: ['ana','luis','maria','diego'] },
  { id: 'e3', description: 'Boletos del museo', amount: 540, payerId: 'maria', participantIds: ['ana','maria','diego'] },
];

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const initials = (name: string) => name.split(/\s+/).map((n) => n[0]).join('').slice(0,2).toUpperCase();

export default function SplitApp() {
  const [people, setPeople] = useState<Person[]>(initialPeople);
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [newName, setNewName] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [payerId, setPayerId] = useState(initialPeople[0].id);
  const [participants, setParticipants] = useState<string[]>(initialPeople.map((p) => p.id));
  const [ready, setReady] = useState(false);
  const peopleRef = useRef(people);
  const expensesRef = useRef(expenses);
  useEffect(() => { peopleRef.current = people; }, [people]);
  useEffect(() => { expensesRef.current = expenses; }, [expenses]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('entre-cuentas-state');
      if (saved) {
        const parsed = JSON.parse(saved) as SavedState;
        if (parsed.people?.length) {
          setPeople(parsed.people); setExpenses(parsed.expenses ?? []);
          setPayerId(parsed.people[0].id); setParticipants(parsed.people.map((p) => p.id));
        }
      }
    } catch { /* Conserva los datos de ejemplo. */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem('entre-cuentas-state', JSON.stringify({ people, expenses }));
  }, [people, expenses, ready]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'add_group_expense', title: 'Agregar gasto del grupo',
      description: 'Registra un gasto, quién lo pagó y entre qué personas se divide.',
      inputSchema: { type:'object', properties:{ description:{type:'string'}, amount:{type:'number',exclusiveMinimum:0}, payerName:{type:'string'}, participantNames:{type:'array',items:{type:'string'}} }, required:['description','amount','payerName'], additionalProperties:false },
      annotations: { readOnlyHint:false, untrustedContentHint:false },
      execute(input) {
        const value = input as { description?:unknown; amount?:unknown; payerName?:unknown; participantNames?:unknown };
        if (typeof value.description !== 'string' || !value.description.trim() || typeof value.amount !== 'number' || value.amount <= 0 || typeof value.payerName !== 'string') throw new Error('Descripción, monto positivo y pagador son obligatorios.');
        const payer = peopleRef.current.find((p) => p.name.toLocaleLowerCase() === value.payerName!.toLocaleLowerCase());
        if (!payer) throw new Error('No existe una persona con ese nombre.');
        const requested = Array.isArray(value.participantNames) ? value.participantNames : peopleRef.current.map((p) => p.name);
        const participantIds = peopleRef.current.filter((p) => requested.some((name) => typeof name === 'string' && name.toLocaleLowerCase() === p.name.toLocaleLowerCase())).map((p) => p.id);
        if (!participantIds.length) throw new Error('Selecciona al menos una persona para dividir el gasto.');
        const expense = { id:crypto.randomUUID(), description:value.description.trim(), amount:value.amount, payerId:payer.id, participantIds };
        const next = [expense, ...expensesRef.current]; expensesRef.current = next; setExpenses(next);
        return { status:'added', description:expense.description, amount:expense.amount, paidBy:payer.name, splitBetween:participantIds.length };
      },
    }, { signal:lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const calculations = useMemo(() => {
    const rows = people.map((person) => {
      const paid = expenses.filter((e) => e.payerId === person.id).reduce((s,e) => s + e.amount, 0);
      const spending = expenses.filter((e) => e.participantIds.includes(person.id)).map((e) => ({ id: e.id, description: e.description, amount: e.amount / e.participantIds.length }));
      const owed = spending.reduce((sum, expense) => sum + expense.amount, 0);
      return { ...person, paid, owed, spending, net: paid - owed };
    });
    const debtors = rows.filter((r) => r.net < -.005).map((r) => ({...r, left:-r.net}));
    const creditors = rows.filter((r) => r.net > .005).map((r) => ({...r, left:r.net}));
    const transfers: {from:string; to:string; amount:number}[] = [];
    let d = 0, c = 0;
    while (d < debtors.length && c < creditors.length) {
      const value = Math.min(debtors[d].left, creditors[c].left);
      transfers.push({ from: debtors[d].name, to: creditors[c].name, amount: value });
      debtors[d].left -= value; creditors[c].left -= value;
      if (debtors[d].left < .01) d++; if (creditors[c].left < .01) c++;
    }
    return { rows, transfers };
  }, [people, expenses]);

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const selectedPayerId = people.some((person) => person.id === payerId) ? payerId : (people[0]?.id ?? '');
  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? 'Alguien';
  const addPerson = () => {
    const name = newName.trim(); if (!name) return;
    const person = { id: crypto.randomUUID(), name };
    setPeople((prev) => [...prev, person]); setParticipants((prev) => [...prev, person.id]); setNewName('');
  };
  const removePerson = (id: string) => {
    if (expenses.some((e) => e.payerId === id || e.participantIds.includes(id))) return;
    setPeople((prev) => prev.filter((p) => p.id !== id)); setParticipants((prev) => prev.filter((p) => p !== id));
  };
  const addExpense = () => {
    const value = Number(amount);
    if (!description.trim() || !selectedPayerId || !Number.isFinite(value) || value <= 0 || participants.length === 0) return;
    setExpenses((prev) => [{ id: crypto.randomUUID(), description: description.trim(), amount: value, payerId: selectedPayerId, participantIds: participants }, ...prev]);
    setDescription(''); setAmount('');
  };
  const toggleParticipant = (id: string) => setParticipants((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="brandmark"><CircleDollarSign size={21}/></span> Entre Cuentas</div>
      <div className="topnote">Los datos se guardan en este dispositivo</div>
    </header>
    <div className="workspace">
      <section className="intro">
        <div><div className="eyebrow">Viaje de amigos</div><h1>Cuentas claras,<br/>amistades largas.</h1><p>Registra lo que pagó cada quien y nosotros hacemos las cuentas.</p></div>
        <div className="trip-total"><span>Gasto total</span><strong>{money.format(total)}</strong></div>
      </section>
      <div className="grid">
        <section className="panel">
          <div className="panel-head"><h2>Agregar datos</h2><p>Personas y nuevos gastos</p></div>
          <div className="panel-body form-stack">
            <div><label className="field-label" htmlFor="person-name">Personas</label><div className="row"><Input id="person-name" value={newName} onChange={(e)=>setNewName(e.target.value)} onKeyDown={(e)=>e.key==='Enter'&&addPerson()} placeholder="Nombre"/><Button size="icon" onClick={addPerson} aria-label="Agregar persona"><Plus/></Button></div></div>
            <div className="people">{people.map((p)=><span className="person-pill" key={p.id}>{p.name}<button title={expenses.some((e)=>e.payerId===p.id||e.participantIds.includes(p.id))?'Tiene gastos asociados':'Eliminar persona'} onClick={()=>removePerson(p.id)} aria-label={`Eliminar a ${p.name}`}>×</button></span>)}</div>
            <div className="expense-form form-stack">
              <div><label className="field-label" htmlFor="description">¿En qué se gastó?</label><Input id="description" value={description} onChange={(e)=>setDescription(e.target.value)} placeholder="Ej. Cena del viernes"/></div>
              <div className="two-col"><div><label className="field-label" htmlFor="amount">Monto</label><Input id="amount" inputMode="decimal" type="number" min="0" step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)} placeholder="$0.00"/></div><div><label className="field-label" htmlFor="payer">Pagó</label><select id="payer" className="select" value={selectedPayerId} onChange={(e)=>setPayerId(e.target.value)}>{people.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div></div>
              <div><div className="field-label">Se divide entre</div><div className="share-list">{people.map((p)=><label className="share-option" key={p.id}><Checkbox checked={participants.includes(p.id)} onCheckedChange={()=>toggleParticipant(p.id)}/><span>{p.name}</span></label>)}</div></div>
              <Button onClick={addExpense} disabled={!people.length}><Plus/> Agregar gasto</Button>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Gastos del grupo</h2><p>{expenses.length} {expenses.length===1?'movimiento':'movimientos'} registrados</p></div>
          <div className="panel-body">{expenses.length ? <div className="expenses">{expenses.map((e)=><article className="expense" key={e.id}><div className="expense-icon"><ReceiptText size={18}/></div><div><div className="expense-title">{e.description}</div><div className="expense-meta">Pagó {personName(e.payerId)} · entre {e.participantIds.length}</div></div><div className="amount">{money.format(e.amount)}<small>{money.format(e.amount/e.participantIds.length)} c/u</small></div><button className="icon-button" onClick={()=>setExpenses((prev)=>prev.filter((x)=>x.id!==e.id))} aria-label={`Eliminar ${e.description}`}><Trash2 size={16}/></button></article>)}</div> : <div className="empty"><ReceiptText size={32}/><strong>Aún no hay gastos</strong><div>Agrega el primero desde el formulario.</div></div>}</div>
        </section>
        <aside className="panel summary">
          <div className="panel-head"><h2>Balance final</h2><p>Lo que pagó vs. lo que le corresponde</p></div>
          <div className="panel-body">
            <div className="balance-list">{calculations.rows.map((r)=><div className="balance" key={r.id}><div className="avatar">{initials(r.name)}</div><div><div className="balance-name">{r.name}</div><div className="balance-caption">Pagó {money.format(r.paid)} · debe {money.format(r.owed)}</div></div><div className={`net ${r.net>=0?'positive':'negative'}`}>{r.net>=0?'+':''}{money.format(r.net)}</div></div>)}</div>
            <div className="settlements"><h3>Para quedar a mano</h3>{calculations.transfers.length ? calculations.transfers.map((t,i)=><div className="transfer" key={i}><strong>{t.from}</strong><ArrowRight size={14}/><span>{t.to}</span><strong>{money.format(t.amount)}</strong></div>) : <div className="all-good">Todo está saldado. Nadie le debe a nadie.</div>}<div className="footnote"><Users size={14} style={{display:'inline',verticalAlign:'-2px',marginRight:5}}/> Cada gasto se reparte por igual sólo entre las personas seleccionadas. Quien paga recibe el abono completo, aunque no participe en el reparto.</div></div>
          </div>
        </aside>
      </div>
      <section className="panel spending-summary" aria-labelledby="spending-title">
        <div className="panel-head"><h2 id="spending-title">Gasto por persona</h2><p>Lo que consumió cada persona, según los gastos en los que participó.</p></div>
        {people.length ? <div className="spending-table-scroll">
          <table className="spending-table" aria-labelledby="spending-title">
            <thead><tr><th scope="col">Persona</th><th scope="col">En qué gastó</th><th scope="col" className="spending-total">Total gastado</th></tr></thead>
            <tbody>{calculations.rows.map((person) => <tr key={person.id}>
              <th scope="row" aria-label={person.name}><div className="spending-person"><span className="avatar" aria-hidden="true">{initials(person.name)}</span><span>{person.name}</span></div></th>
              <td>{person.spending.length ? <ul className="spending-details">{person.spending.map((expense) => <li key={expense.id}><span>{expense.description}</span><span>{money.format(expense.amount)}</span></li>)}</ul> : <span className="spending-empty">Sin gastos asignados</span>}</td>
              <td className="spending-total">{money.format(person.owed)}</td>
            </tr>)}</tbody>
            <tfoot><tr><th scope="row" colSpan={2}>Total del grupo</th><td className="spending-total">{money.format(calculations.rows.reduce((sum, person) => sum + person.owed, 0))}</td></tr></tfoot>
          </table>
        </div> : <div className="empty"><Users size={32}/><strong>Aún no hay personas</strong><div>Agrega personas para ver sus gastos.</div></div>}
      </section>
    </div>
  </main>;
}
