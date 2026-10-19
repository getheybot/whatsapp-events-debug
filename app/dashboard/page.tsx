import { requireUser } from '../../lib/auth';
import { prismaRead } from '../../lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
const pageSize = 20;
const statuses = ['received', 'sent', 'delivered', 'failed', 'read'];
function jsonText(value: unknown) { return JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v, 2) || '{}'; }
function highlightedJson(value: unknown) {
  return jsonText(value).split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b)/g).map((token, index) => {
    let kind: string | undefined;
    if (token.startsWith('"')) kind = token.endsWith(':') ? 'key' : 'string';
    else if (/^-?\d/.test(token)) kind = 'number';
    else if (/^(true|false)$/.test(token)) kind = 'boolean';
    else if (token === 'null') kind = 'null';
    return kind ? <span key={index} className={`json-${kind}`}>{token}</span> : token;
  });
}
export default async function Dashboard({searchParams}:{searchParams:Promise<{q?:string;status?:string;page?:string;id?:string}>}) {
  const user = await requireUser();
  const params = await searchParams;
  const q = (params.q || '').trim().slice(0, 150);
  const status = params.status || 'all';
  const page = Math.max(1, Math.min(100000, Number.parseInt(params.page || '1',10) || 1));
  const id = params.id;
  const where = {
    ...(status !== 'all' ? {eventName:status} : {}),
    ...(q ? {OR:[{wamid:{contains:q,mode:'insensitive' as const}},...( /^\d+$/.test(q) ? [{id:BigInt(q)}] : [])]} : {})
  };
  const [events,total] = await Promise.all([
    prismaRead.whatsappEvent.findMany({where,orderBy:[{eventAt:'desc'},{id:'desc'}],take:pageSize,skip:(page-1)*pageSize}),
    prismaRead.whatsappEvent.count({where})
  ]);
  const selected = id ? await prismaRead.whatsappEvent.findUnique({where:{id:/^\d+$/.test(id) ? BigInt(id) : BigInt(0)}}) : events[0];
  const makeUrl = (updates:Record<string,string>) => '/dashboard?' + new URLSearchParams({...(q?{q}:{}),...(status!=='all'?{status}:{}),page:String(page),...updates}).toString();
  const content = selected?.content;
  return <div className="dashboard"><aside className="sidebar"><a className="sidebarBrand" href="https://heybot.cloud">heybot</a><form action="/dashboard" className="filters"><input name="q" defaultValue={q} placeholder="⌕  Search by WAMID or Request ID" aria-label="Search events"/><select name="status" defaultValue={status} aria-label="Filter by status"><option value="all">All statuses</option>{statuses.map(status=><option key={status} value={status}>{status}</option>)}</select><button type="submit" className="filterButton">Search</button></form><div className="events">{events.map(e=><Link key={e.id.toString()} href={makeUrl({id:e.id.toString()})} className={'event '+(selected?.id===e.id?'active':'')}><div className="eventTop"><span className="eventName"><i className={'dot '+e.eventName.toLowerCase()}/>{e.eventName}</span><time dateTime={e.eventAt.toISOString()} title="event_at (UTC)">{e.eventAt.toISOString().replace('T',' ').slice(0,19)} UTC</time></div><div className="wamid">{e.wamid}</div><div className="statusCode">{e.code.toString()}</div></Link>)}{events.length===0 && <div className="emptySide">No matching events</div>}</div><footer className="sidebarFooter"><Link href="/dashboard" className="refresh" title="Refresh">⟳</Link><span>{total.toLocaleString()} events</span><div className="pagination"><Link aria-disabled={page<=1} className={page<=1?'disabled':''} href={makeUrl({page:String(Math.max(1,page-1)),id:''})}>« Previous</Link><Link aria-disabled={page*pageSize>=total} className={page*pageSize>=total?'disabled':''} href={makeUrl({page:String(page+1),id:''})}>Next »</Link></div></footer></aside><main className="main"><header className="topbar"><span>Heybot - Event Debugger</span><div className="account"><span>{user}</span><form action="/api/logout" method="post"><button>Sign out</button></form></div></header>{selected?<div className="detail"><h1><i className={'dot '+selected.eventName.toLowerCase()}/>{selected.eventName}</h1><section className="panel"><h2>Overview</h2><dl><div><dt>Wamid</dt><dd>{selected.wamid}</dd></div><div><dt>UTC</dt><dd>{selected.eventAt.toISOString()}</dd></div><div><dt>Code</dt><dd>{selected.code.toString()}</dd></div></dl></section><section className="panel raw"><div className="rawHeader"><h2>Raw event</h2><p>Original event payload.</p></div><pre><code>{highlightedJson(content)}</code></pre></section></div>:<div className="noSelection">No event selected.</div>}</main></div>;
}
