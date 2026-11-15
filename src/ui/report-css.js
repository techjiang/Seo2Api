export const REPORT_CSS = `
.score-hero{display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:center;
  background:linear-gradient(180deg,var(--panel),var(--bg-soft));border:1px solid var(--line);
  border-radius:18px;padding:26px 28px;margin-bottom:18px;position:relative;overflow:hidden}
.score-hero::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(560px 220px at 8% 0%,var(--glow,rgba(34,211,165,.13)),transparent 70%)}
.ring{position:relative;width:158px;height:158px;flex:0 0 auto}
.ring svg{transform:rotate(-90deg);display:block}
.ring .val{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring .num{font-size:42px;font-weight:800;letter-spacing:-.03em;line-height:1}
.ring .grd{font-size:12.5px;font-weight:700;letter-spacing:.12em;margin-top:6px;opacity:.9}
.score-meta h1{font-size:22px;margin:0 0 6px;letter-spacing:-.01em;word-break:break-all}
.score-meta .url{font-family:var(--mono);font-size:12.5px;color:var(--muted);word-break:break-all}
.score-meta .headline{margin:12px 0 0;font-size:14.5px;color:#c7d4e0;line-height:1.65;max-width:70ch}
.pills{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}

.dims{display:grid;grid-template-columns:repeat(auto-fit,minmax(216px,1fr));gap:12px;margin:0 0 8px}
.dim-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-sm);padding:14px 15px}
.dim-card .top{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:9px}
.dim-card .nm{font-size:13px;font-weight:600;color:#d3dee8}
.dim-card .sc{font-size:17px;font-weight:800;font-family:var(--mono);letter-spacing:-.02em}
.dim-card .bar{height:6px;border-radius:4px;background:var(--line);overflow:hidden}
.dim-card .bar i{display:block;height:100%;border-radius:4px;transition:width .5s ease}
.dim-card .sub{font-size:11px;color:var(--muted);margin-top:9px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.dim-card .sub .cnt{white-space:nowrap}
.dim-card .sub .wt{margin-left:auto;color:var(--dim);font-family:var(--mono);font-size:10.5px}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;vertical-align:1px}

.radar-wrap{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin-bottom:8px}
.radar-wrap svg{display:block;margin:0 auto;max-width:100%;height:auto}
@media(max-width:520px){.radar-wrap{padding:10px}}

.prio{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px}
.prio li{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--warn);
  border-radius:var(--radius-sm);padding:14px 16px}
.prio li.sev-critical{border-left-color:var(--fail)}
.prio li.sev-major{border-left-color:#f97316}
.prio li .pt{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
.prio li .pt h3{margin:0;font-size:14.5px;flex:1 1 auto;min-width:180px}
.prio li .msg{font-size:13.5px;color:var(--muted);margin:0 0 8px;line-height:1.6}
.gain{font-family:var(--mono);font-size:11.5px;color:var(--brand);background:rgba(34,211,165,.1);
  border:1px solid rgba(34,211,165,.25);padding:2px 8px;border-radius:6px;white-space:nowrap}

.checks{display:flex;flex-direction:column;gap:1px;background:var(--line-soft);
  border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.chk{background:var(--panel);padding:13px 16px}
.chk summary{cursor:pointer;list-style:none;display:flex;gap:11px;align-items:center;flex-wrap:wrap}
.chk summary::-webkit-details-marker{display:none}
.chk summary::before{content:'▸';color:var(--dim);font-size:11px;transition:.15s}
.chk[open] summary::before{transform:rotate(90deg)}
.chk .ct{font-size:14px;font-weight:600}
.chk summary .dim{margin-left:auto}
.chk .cm{font-size:13px;color:var(--muted);margin:9px 0 0;line-height:1.65}
.chk .cd{font-size:12.5px;color:var(--dim);margin:8px 0 0;line-height:1.6}
.chk pre{margin:10px 0 0}
.sev{font-size:10.5px;font-weight:700;letter-spacing:.06em;padding:2px 7px;border-radius:5px;
  text-transform:uppercase;background:var(--panel-2);color:var(--dim);border:1px solid var(--line)}

.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.fact{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-sm);padding:16px}
.fact h3{font-size:12.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.07em;margin:0 0 10px}
.fact .kv{border-bottom:1px dashed var(--line-soft)}
.tabs{display:flex;gap:6px;margin:0 0 14px;flex-wrap:wrap}
.tabs button{background:var(--panel);border:1px solid var(--line);color:var(--muted);
  padding:7px 14px;border-radius:8px;font-size:13px}
.tabs button[aria-selected=true]{background:rgba(34,211,165,.12);border-color:rgba(34,211,165,.4);color:var(--brand)}
.badge-preview{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.badge-preview img{height:20px}
.note{font-size:12.5px;color:var(--dim);margin-top:10px;line-height:1.6}
@media(max-width:720px){
  .score-hero{grid-template-columns:1fr;gap:18px;padding:20px}
  .ring{margin:0 auto}
  .ring,.ring svg{width:132px;height:132px}
  .ring .num{font-size:34px}
}
`;
